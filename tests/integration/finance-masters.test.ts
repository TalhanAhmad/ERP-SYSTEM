import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { readFile } from "node:fs/promises";
import pg from "pg";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
process.env.FINANCE_ENABLED = "true";
const { db } = await import("@/server/db"),
  { env } = await import("@/server/env");
const { verifyFinanceReauthentication } =
    await import("@/modules/finance/access/reauth"),
  { setupOwner } = await import("@/modules/finance/access/service"),
  { setupCommand } = await import("@/modules/finance/accounting/service");
const { masterCommand, masters, masterDetail } =
    await import("@/modules/finance/masters/service"),
  { masterRead, masterMutation } =
    await import("@/modules/finance/masters/http");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "M10." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Master-synthetic-fixture-only-9#";
let counter = 0;
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const req = (who = "owner", body?: unknown) =>
  new Request(env.APP_URL + "/api/v1/finance/parties", {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookies[who] ?? "",
      origin: env.APP_URL,
      "x-encova-csrf": "1",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const proof = (who = "owner") =>
  verifyFinanceReauthentication(req(who), { password });
async function command(
  action: Parameters<typeof masterCommand>[2],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return masterCommand(v.actor, v.proof, action, body, key);
}
async function config(
  action: Parameters<typeof setupCommand>[2],
  body: unknown,
) {
  const v = await proof();
  return setupCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
const party = (patch: Record<string, unknown> = {}) => ({
  name: prefix + " party " + ++counter,
  legalName: prefix + " Legal Co",
  kind: "CLIENT",
  contactEmail: "synthetic@example.test",
  phone: "+92 000 0000000",
  address: "Synthetic address only",
  userId: null,
  reason: "Reviewed isolated master setup",
  ...patch,
});
async function account(patch: Record<string, unknown> = {}) {
  return (
    await config("ACCOUNT_CREATE", {
      code: prefix + "." + ++counter,
      name: prefix + " cash GL " + counter,
      type: "ASSET",
      normalSide: "DEBIT",
      reportGroup: "CURRENT_ASSETS",
      controlType: "CASH",
      currency: "PKR",
      parentId: null,
      isPosting: true,
      isContra: false,
      isCashEquivalent: false,
      reason: "Isolated cash mapping fixture",
      ...patch,
    })
  ).id;
}
const cash = (glAccountId: string, patch: Record<string, unknown> = {}) => ({
  name: prefix + " cash " + ++counter,
  kind: "BANK",
  glAccountId,
  currency: "PKR",
  maskedReference: "1234",
  reason: "Reviewed isolated cash setup",
  ...patch,
});
async function release() {
  const ids = Object.values(people).map((p) => p.id),
    s = await db.financeSettings.findFirst();
  if (s && !ids.includes(s.ownerId))
    throw new Error("Refuse unowned finance singleton cleanup");
  if (s) await db.$executeRawUnsafe('TRUNCATE "FinanceSettings"');
  await db.financeOwnershipTransfer.deleteMany({
    where: { currentOwnerId: { in: ids } },
  });
  await db.financeGrant.deleteMany({ where: { userId: { in: ids } } });
}
beforeAll(async () => {
  env.FINANCE_ENABLED = true;
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(
      "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;",
    );
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
  } finally {
    await sql.end();
  }
  for (const [name, role] of [
    ["owner", "SUPER_ADMIN"],
    ["selected", "SUPER_ADMIN"],
    ["other", "SUPER_ADMIN"],
    ["hr", "HR_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
  ] as const) {
    const email = prefix.toLowerCase() + "." + name + "@example.test",
      s = await auth.api.signUpEmail({ body: { name, email, password } });
    await db.user.update({
      where: { id: s.user.id },
      data: { emailVerified: true },
    });
    people[name] = await db.person.create({
      data: {
        email,
        authUserId: s.user.id,
        username: prefix.toLowerCase() + "." + name,
        displayName: name,
        role,
        status: "ACTIVE",
      },
    });
    const session = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    cookies[name] = session.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }
  await release();
  const v = await proof();
  await setupOwner(
    v.actor,
    v.proof,
    people.owner.username,
    "Explicit isolated F10 owner",
  );
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "Selected read-only master fixture",
    },
  });
}, 30000);
afterAll(async () => {
  await release();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("denies every unselected role on lists/details and owner-only HTTP writes", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    for (const resource of ["parties", "cash-accounts"] as const) {
      await expect(
        masters(people[who], resource, { bad: true }),
      ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
      await expect(
        masterDetail(people[who], resource, crypto.randomUUID()),
      ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    }
    expect(
      (
        await masterMutation(
          req(who, { ...party(), reauth: { password } }),
          "PARTY_CREATE",
        )
      ).status,
    ).toBe(403);
  }
});
it("allows selected reads but rejects selected writes inside the database function", async () => {
  const p = await command("PARTY_CREATE", party());
  expect((await masterDetail(people.selected, "parties", p.id)).canManage).toBe(
    false,
  );
  await expect(
    command("PARTY_CREATE", party(), undefined, "selected"),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_REQUIRED" });
});
it("stores optional contact/person links separately without balance or auth fields", async () => {
  const input = party({ userId: people.member.id }),
    p = await command("PARTY_CREATE", input);
  const view = await masterDetail(people.owner, "parties", p.id);
  expect(view.item).toMatchObject({
    legalName: input.legalName,
    userId: people.member.id,
    active: true,
    version: 1,
  });
  expect(view.item).not.toHaveProperty("balance");
  expect(JSON.stringify(view)).not.toContain(password);
  expect(view.history).toHaveLength(1);
});
it("rejects unknown financial fields, bad kinds, invalid contact and nonexistent person links", async () => {
  for (const patch of [
    { balance: "100" },
    { kind: "BANK" },
    { contactEmail: "invalid" },
    { phone: "javascript:bad" },
    { bankNumber: "1234567890" },
  ])
    await expect(command("PARTY_CREATE", party(patch))).rejects.toThrow();
  await expect(
    command("PARTY_CREATE", party({ userId: crypto.randomUUID() })),
  ).rejects.toMatchObject({ code: "FINANCE_INVALID_INPUT" });
});
it("creates a unique protected cash mapping with only a four-digit reference", async () => {
  const gl = await account(),
    c = await command("CASH_CREATE", cash(gl)),
    view = await masterDetail(people.selected, "cash-accounts", c.id);
  expect(view.item).toMatchObject({
    glAccountId: gl,
    maskedReference: "1234",
    currency: "PKR",
  });
  await expect(command("CASH_CREATE", cash(gl))).rejects.toMatchObject({
    code: "FINANCE_CASH_DUPLICATE",
  });
});
it("rejects full bank numbers, non-PKR cash and ordinary/group GL mappings", async () => {
  const gl = await account();
  for (const patch of [
    { maskedReference: "12345678" },
    { maskedReference: "1234\n" },
    { currency: "USD" },
    { bankNumber: "1234" },
  ])
    await expect(command("CASH_CREATE", cash(gl, patch))).rejects.toThrow();
  for (const patch of [
    { controlType: "NONE" },
    { controlType: "NONE", isPosting: false },
  ]) {
    const invalid = await account(patch);
    await expect(command("CASH_CREATE", cash(invalid))).rejects.toMatchObject({
      code: "FINANCE_CASH_MAPPING",
    });
  }
});
it("replays concurrent same-key setup once and rejects changed input", async () => {
  const input = party(),
    key = crypto.randomUUID(),
    results = await Promise.all([
      command("PARTY_CREATE", input, key),
      command("PARTY_CREATE", input, key),
    ]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.financeParty.count({ where: { name: input.name } })).toBe(1);
  await expect(
    command("PARTY_CREATE", { ...input, name: "Changed" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  expect(
    await db.financeSetupReceipt.count({
      where: { actorId: people.owner.id, key },
    }),
  ).toBe(1);
});
it("allows one of two concurrent GL bindings and leaves no failed audit/receipt", async () => {
  const gl = await account(),
    a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const results = await Promise.allSettled([
    command("CASH_CREATE", cash(gl), a),
    command("CASH_CREATE", cash(gl), b),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.financeSetupReceipt.count({
      where: { actorId: people.owner.id, key: { in: [a, b] } },
    }),
  ).toBe(1);
});
it("uses optimistic versions and records restricted before/after changes", async () => {
  const input = party(),
    p = await command("PARTY_CREATE", input);
  await command("PARTY_UPDATE", {
    ...input,
    id: p.id,
    expectedVersion: 1,
    name: "Corrected display name",
  });
  await expect(
    command("PARTY_UPDATE", { ...input, id: p.id, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  const h = await db.financeAuditEvent.findFirstOrThrow({
    where: { entityId: p.id, action: "FINANCE_PARTY_UPDATE" },
  });
  expect(h.data).toMatchObject({
    before: { name: input.name },
    after: { name: "Corrected display name" },
  });
});
it("archives/reactivates parties without deleting user linkage or history", async () => {
  const p = await command("PARTY_CREATE", party({ userId: people.member.id }));
  await command("PARTY_ARCHIVE", {
    id: p.id,
    expectedVersion: 1,
    reason: "Retain archived contact",
  });
  await command("PARTY_REACTIVATE", {
    id: p.id,
    expectedVersion: 2,
    reason: "Restore contact",
  });
  expect((await masterDetail(people.owner, "parties", p.id)).item.active).toBe(
    true,
  );
  await expect(
    db.financeParty.delete({ where: { id: p.id } }),
  ).rejects.toThrow();
});
it("locks used party identity/classification but allows current contact corrections", async () => {
  const input = party(),
    p = await command("PARTY_CREATE", input);
  await db.financeParty.update({
    where: { id: p.id },
    data: { usedAt: new Date() },
  });
  await expect(
    command("PARTY_UPDATE", {
      ...input,
      id: p.id,
      expectedVersion: 1,
      kind: "SUPPLIER",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_MASTER_USED" });
  await command("PARTY_UPDATE", {
    ...input,
    id: p.id,
    expectedVersion: 1,
    legalName: "Corrected current legal name",
  });
  await expect(
    db.financeParty.update({ where: { id: p.id }, data: { usedAt: null } }),
  ).rejects.toThrow();
});
it("freezes used cash mapping/kind/reference and permits name correction", async () => {
  const gl = await account(),
    input = cash(gl),
    c = await command("CASH_CREATE", input);
  await db.financeAccount.update({
    where: { id: gl },
    data: { usedAt: new Date() },
  });
  for (const patch of [
    { kind: "CASH" },
    { maskedReference: "9999" },
    { glAccountId: await account() },
  ])
    await expect(
      command("CASH_UPDATE", {
        ...input,
        id: c.id,
        expectedVersion: 1,
        ...patch,
      }),
    ).rejects.toMatchObject({ code: "FINANCE_MASTER_USED" });
  await command("CASH_UPDATE", {
    ...input,
    id: c.id,
    expectedVersion: 1,
    name: "Corrected cash name",
  });
});
it("requires cash-before-GL archive order and valid GL before reactivation", async () => {
  const gl = await account(),
    c = await command("CASH_CREATE", cash(gl));
  await expect(
    config("ACCOUNT_ARCHIVE", {
      id: gl,
      expectedVersion: 1,
      reason: "Wrong archive order",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_MAPPING" });
  await command("CASH_ARCHIVE", {
    id: c.id,
    expectedVersion: 1,
    reason: "Archive cash first",
  });
  await config("ACCOUNT_ARCHIVE", {
    id: gl,
    expectedVersion: 1,
    reason: "Archive GL second",
  });
  await expect(
    command("CASH_REACTIVATE", {
      id: c.id,
      expectedVersion: 2,
      reason: "Inactive GL",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_MAPPING" });
  await config("ACCOUNT_REACTIVATE", {
    id: gl,
    expectedVersion: 2,
    reason: "Restore GL first",
  });
  await command("CASH_REACTIVATE", {
    id: c.id,
    expectedVersion: 2,
    reason: "Restore cash second",
  });
  await expect(
    db.financeCashAccount.delete({ where: { id: c.id } }),
  ).rejects.toThrow();
});
it("guards linked GL structural mappings even with direct operator SQL", async () => {
  const gl = await account();
  await command("CASH_CREATE", cash(gl));
  await expect(
    db.financeAccount.update({
      where: { id: gl },
      data: { controlType: "NONE" },
    }),
  ).rejects.toThrow();
});
it("keeps filtered list counts and stable pages consistent", async () => {
  const q = prefix + ".PAGE";
  for (let n = 0; n < 3; n++)
    await command("PARTY_CREATE", party({ name: q + n }));
  const first = await masters(people.owner, "parties", { q, pageSize: 2 }),
    second = await masters(people.owner, "parties", {
      q,
      pageSize: 2,
      page: 2,
    });
  expect(first.total).toBe(3);
  expect(first.items).toHaveLength(2);
  expect(second.items).toHaveLength(1);
  await expect(
    masters(people.owner, "cash-accounts", { kind: "CLIENT" }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    masters(people.owner, "parties", { sort: "raw SQL" }),
  ).rejects.toThrow();
});
it("has read-only runtime tables, no Data API access and actual restricted command execution", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
    for (const role of ["anon", "authenticated", "encova_app"]) {
      await sql.query("BEGIN");
      await sql.query(`SET LOCAL ROLE ${role}`);
      await expect(
        sql.query(
          role === "encova_app"
            ? 'UPDATE "FinanceCashAccount" SET active=false'
            : 'SELECT * FROM "FinanceParty"',
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await sql.query("ROLLBACK");
    }
    const session = await auth.api.getSession({ headers: req().headers });
    await sql.query("BEGIN");
    await sql.query("SET LOCAL ROLE encova_app");
    const result = await sql.query(
      "SELECT encova_finance_master_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'PARTY_CREATE',$3::jsonb,$4,$5) AS result",
      [
        people.owner.id,
        session!.session.id,
        JSON.stringify(party()),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    );
    expect(result.rows[0].result.id).toBeTruthy();
    await sql.query("COMMIT");
  } finally {
    await sql.end();
  }
});
it("returns private errors, strict bodies, missing-origin denial and disabled 404", async () => {
  const response = await masterRead(req(), "parties");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  await db.rateLimit.deleteMany({
    where: { id: { startsWith: `finance:reauth:${people.owner.id}:` } },
  });
  expect(
    (
      await masterMutation(
        req("owner", { ...party(), active: false, reauth: { password } }),
        "PARTY_CREATE",
      )
    ).status,
  ).toBe(422);
  const bad = req("owner", { ...party(), reauth: { password } });
  bad.headers.delete("origin");
  expect((await masterMutation(bad, "PARTY_CREATE")).status).toBe(403);
  env.FINANCE_ENABLED = false;
  try {
    expect((await masterRead(req(), "parties")).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
