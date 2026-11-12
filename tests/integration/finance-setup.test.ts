import "dotenv/config";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import pg from "pg";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
process.env.FINANCE_ENABLED = "true";
const { db } = await import("@/server/db");
const { env } = await import("@/server/env");
const { setupOwner, accessCommand } =
  await import("@/modules/finance/access/service");
const { verifyFinanceReauthentication } =
  await import("@/modules/finance/access/reauth");
const { setupCommand, accounts, accountDetail, periods, periodDetail } =
  await import("@/modules/finance/accounting/service");
const { setupRead, setupMutation } =
  await import("@/modules/finance/accounting/http");
const { parsePkr } = await import("@/modules/finance/accounting/money");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const createAuth = () =>
  betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
let auth: ReturnType<typeof createAuth>, anchor: Date;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {};
const suffix = crypto.randomUUID().slice(0, 7).toUpperCase(),
  codePrefix = `F05.${suffix}`;
const password = "Finance-setup-fixture-9#";
let counter = 0;
const req = (who = "owner", body?: unknown) =>
  new Request("http://localhost:3000/api/v1/finance/accounts", {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookies[who],
      origin: env.APP_URL,
      "x-encova-csrf": "1",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const proof = (who = "owner") =>
  verifyFinanceReauthentication(req(who), { password });
const newAccount = (patch: Record<string, unknown> = {}) => ({
  code: `${codePrefix}.${++counter}`,
  name: `${codePrefix} account ${counter}`,
  type: "ASSET",
  normalSide: "DEBIT",
  reportGroup: "CURRENT_ASSETS",
  controlType: "NONE",
  currency: "PKR",
  parentId: null,
  isPosting: true,
  isContra: false,
  isCashEquivalent: false,
  reason: "Reviewed isolated chart fixture",
  ...patch,
});
async function command(
  action: Parameters<typeof setupCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const verified = await proof(who);
  return setupCommand(verified.actor, verified.proof, action, input, key);
}
const date = (days: number) =>
  new Date(anchor.getTime() + days * 86400000).toISOString().slice(0, 10);
const newPeriod = (patch: Record<string, unknown> = {}) => ({
  name: `${codePrefix} period`,
  startDate: date(0),
  endDate: date(29),
  reason: "Explicit isolated reporting range",
  ...patch,
});
async function releaseOwnedSingleton() {
  const setting = await db.financeSettings.findFirst();
  if (setting && !Object.values(people).some((p) => p.id === setting.ownerId))
    throw new Error("Refuse to clear unowned finance owner");
  if (setting) await db.$executeRawUnsafe('TRUNCATE "FinanceSettings"');
  await db.financeOwnershipTransfer.deleteMany({
    where: { currentOwnerId: { in: Object.values(people).map((p) => p.id) } },
  });
  await db.financeGrant.deleteMany({
    where: { userId: { in: Object.values(people).map((p) => p.id) } },
  });
}
beforeAll(async () => {
  env.FINANCE_ENABLED = true;
  auth = createAuth();
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(
      `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;`,
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
    const email = `f05.${name}.${suffix.toLowerCase()}@example.test`;
    const signed = await auth.api.signUpEmail({
      body: { email, name, password },
    });
    await db.user.update({
      where: { id: signed.user.id },
      data: { emailVerified: true },
    });
    people[name] = await db.person.create({
      data: {
        email,
        username: `f05.${name}.${suffix.toLowerCase()}`,
        displayName: name,
        role,
        status: "ACTIVE",
        authUserId: signed.user.id,
      },
    });
  }
});
beforeEach(async () => {
  await releaseOwnedSingleton();
  for (const [name, p] of Object.entries(people)) {
    await db.person.update({
      where: { id: p.id },
      data: { status: "ACTIVE", role: p.role },
    });
    const signed = await auth.api.signInEmail({
      body: { email: p.email, password },
      asResponse: true,
    });
    cookies[name] = signed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    await db.rateLimit.deleteMany({
      where: { id: { startsWith: `finance:reauth:${p.id}:` } },
    });
  }
  const v = await proof();
  await setupOwner(
    v.actor,
    v.proof,
    people.owner.username,
    "Explicit F05 test owner",
  );
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "Explicit selected read-only setup fixture",
    },
  });
  const latest = await db.financePeriod.findFirst({
    orderBy: { endDate: "desc" },
    select: { endDate: true },
  });
  anchor = new Date(
    (latest?.endDate ?? new Date("6000-01-01T00:00:00Z")).getTime() +
      35 * 86400000,
  );
});
afterAll(async () => {
  await releaseOwnedSingleton();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  // Accounts/periods and immutable receipts/audit are retained in this disposable
  // test database. No production or unrelated ERP records are removed.
  await db.$disconnect();
});
it("denies every unselected/lower role on chart, period, detail and mutation boundaries", async () => {
  const created = await command("ACCOUNT_CREATE", newAccount());
  for (const name of ["other", "hr", "lead", "member"]) {
    await expect(accounts(people[name])).rejects.toMatchObject({ status: 403 });
    await expect(periods(people[name])).rejects.toMatchObject({ status: 403 });
    await expect(accountDetail(people[name], created.id)).rejects.toMatchObject(
      { status: 403 },
    );
    expect((await setupRead(req(name), "accounts")).status).toBe(403);
    expect(
      (
        await setupMutation(
          req(name, { ...newAccount(), reauth: { password } }),
          "ACCOUNT_CREATE",
        )
      ).status,
    ).toBe(403);
  }
});
it("allows selected-admin reads but only the current owner can configure", async () => {
  await command("ACCOUNT_CREATE", newAccount());
  expect((await accounts(people.selected, { q: codePrefix })).canManage).toBe(
    false,
  );
  await expect(
    command("ACCOUNT_CREATE", newAccount(), crypto.randomUUID(), "selected"),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_REQUIRED" });
  expect(
    (
      await setupMutation(
        req("selected", { ...newAccount(), reauth: { password } }),
        "ACCOUNT_CREATE",
      )
    ).status,
  ).toBe(403);
});
it("normalizes codes, creates parent groups and preserves contra/control classifications", async () => {
  const group = await command(
    "ACCOUNT_CREATE",
    newAccount({ isPosting: false }),
  );
  const leaf = await command(
    "ACCOUNT_CREATE",
    newAccount({
      parentId: group.id,
      controlType: "CASH",
      isCashEquivalent: true,
      code: `${codePrefix}.CASH`.toLowerCase(),
    }),
  );
  const account = await accountDetail(people.owner, leaf.id);
  expect(account.item).toMatchObject({
    code: `${codePrefix}.CASH`,
    currency: "PKR",
    parentId: group.id,
    controlType: "CASH",
    isCashEquivalent: true,
  });
  expect(account.item).not.toHaveProperty("balance");
  const contra = await command(
    "ACCOUNT_CREATE",
    newAccount({
      reportGroup: "NONCURRENT_ASSETS",
      controlType: "ACCUMULATED_DEPRECIATION",
      normalSide: "CREDIT",
      isContra: true,
    }),
  );
  expect((await accountDetail(people.owner, contra.id)).item.isContra).toBe(
    true,
  );
});
it("records only private setup receipts/audit and serializes duplicate request keys", async () => {
  const body = newAccount(),
    key = crypto.randomUUID();
  const results = await Promise.all([
    command("ACCOUNT_CREATE", body, key),
    command("ACCOUNT_CREATE", body, key),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.financeAccount.count({ where: { code: body.code } })).toBe(1);
  expect(
    await db.financeAuditEvent.count({
      where: { entityId: results[0].id, action: "FINANCE_ACCOUNT_CREATE" },
    }),
  ).toBe(1);
  await expect(
    command("ACCOUNT_CREATE", { ...body, name: "Changed request" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  const receipt = await db.financeSetupReceipt.findFirstOrThrow({
    where: { actorId: people.owner.id, key },
  });
  expect(JSON.stringify(receipt)).not.toContain(password);
  expect(
    await db.idempotency.count({ where: { actorId: people.owner.id, key } }),
  ).toBe(0);
  expect(await db.audit.count({ where: { entityId: results[0].id } })).toBe(0);
  await expect(
    db.financeSetupReceipt.delete({ where: { id: receipt.id } }),
  ).rejects.toThrow();
});
it("supports versioned pre-use edits and rejects stale updates or duplicate codes", async () => {
  const body = newAccount(),
    created = await command("ACCOUNT_CREATE", body);
  await command("ACCOUNT_UPDATE", {
    ...body,
    id: created.id,
    expectedVersion: 1,
    name: "Renamed unused account",
  });
  await expect(
    command("ACCOUNT_UPDATE", { ...body, id: created.id, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await expect(command("ACCOUNT_CREATE", body)).rejects.toMatchObject({
    code: "FINANCE_ACCOUNT_CODE_EXISTS",
  });
});
it("validates configuration at the service boundary rather than trusting the caller", async () => {
  for (const patch of [
    { balance: "100.00" },
    { currency: "USD" },
    { usedAt: new Date().toISOString() },
    { normalSide: "CREDIT" },
    { reportGroup: "REVENUE" },
  ])
    await expect(
      command("ACCOUNT_CREATE", newAccount(patch)),
    ).rejects.toThrow();
});
it("prevents posting parents, mismatched groups and circular ancestry", async () => {
  const leaf = await command("ACCOUNT_CREATE", newAccount());
  await expect(
    command("ACCOUNT_CREATE", newAccount({ parentId: leaf.id })),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_PARENT" });
  const rootBody = newAccount({ isPosting: false }),
    root = await command("ACCOUNT_CREATE", rootBody);
  const child = await command(
    "ACCOUNT_CREATE",
    newAccount({ isPosting: false, parentId: root.id }),
  );
  await expect(
    command("ACCOUNT_UPDATE", {
      ...rootBody,
      id: root.id,
      parentId: child.id,
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_CYCLE" });
  await expect(
    command(
      "ACCOUNT_CREATE",
      newAccount({ parentId: root.id, reportGroup: "NONCURRENT_ASSETS" }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_PARENT" });
});
it("requires child-first archiving and retains referenced records and codes", async () => {
  const root = await command(
      "ACCOUNT_CREATE",
      newAccount({ isPosting: false }),
    ),
    body = newAccount({ parentId: root.id }),
    leaf = await command("ACCOUNT_CREATE", body);
  await expect(
    command("ACCOUNT_ARCHIVE", {
      id: root.id,
      expectedVersion: 1,
      reason: "Parent before child",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_CHILDREN" });
  await command("ACCOUNT_ARCHIVE", {
    id: leaf.id,
    expectedVersion: 1,
    reason: "Archive child first",
  });
  await command("ACCOUNT_ARCHIVE", {
    id: root.id,
    expectedVersion: 1,
    reason: "Archive group second",
  });
  await expect(
    command("ACCOUNT_REACTIVATE", {
      id: leaf.id,
      expectedVersion: 2,
      reason: "Inactive parent test",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_PARENT" });
  await command("ACCOUNT_REACTIVATE", {
    id: root.id,
    expectedVersion: 2,
    reason: "Restore parent",
  });
  await command("ACCOUNT_REACTIVATE", {
    id: leaf.id,
    expectedVersion: 2,
    reason: "Restore child",
  });
  await expect(
    db.financeAccount.delete({ where: { id: leaf.id } }),
  ).rejects.toThrow();
  await expect(command("ACCOUNT_CREATE", body)).rejects.toMatchObject({
    code: "FINANCE_ACCOUNT_CODE_EXISTS",
  });
});
it("locks used account and ancestor mappings while allowing label corrections", async () => {
  const groupBody = newAccount({ isPosting: false }),
    group = await command("ACCOUNT_CREATE", groupBody);
  const body = newAccount({ parentId: group.id }),
    leaf = await command("ACCOUNT_CREATE", body);
  await db.financeAccount.update({
    where: { id: leaf.id },
    data: { usedAt: new Date() },
  });
  expect((await accountDetail(people.owner, group.id)).item.mappingLocked).toBe(
    true,
  );
  await expect(
    command("ACCOUNT_UPDATE", {
      ...body,
      id: leaf.id,
      expectedVersion: 1,
      code: `${codePrefix}.USED`,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_USED" });
  await expect(
    command("ACCOUNT_UPDATE", {
      ...groupBody,
      id: group.id,
      expectedVersion: 1,
      code: `${codePrefix}.GROUP`,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_USED" });
  await command("ACCOUNT_UPDATE", {
    ...body,
    id: leaf.id,
    expectedVersion: 1,
    name: "Corrected label",
  });
  await expect(
    db.financeAccount.update({
      where: { id: leaf.id },
      data: { usedAt: null },
    }),
  ).rejects.toThrow();
});
it("enforces classification and ownership independently for raw database writes", async () => {
  const a = await command("ACCOUNT_CREATE", newAccount());
  for (const data of [
    { currency: "USD" },
    { normalSide: "CREDIT" },
    { reportGroup: "REVENUE" },
    { isCashEquivalent: true },
  ])
    await expect(
      db.financeAccount.update({ where: { id: a.id }, data }),
    ).rejects.toThrow();
});
it("creates real DATE periods and excludes inclusive overlapping boundaries", async () => {
  const a = await command("PERIOD_CREATE", newPeriod());
  const stored = await periodDetail(people.selected, a.id);
  expect(stored.item.startDate.toISOString().slice(0, 10)).toBe(date(0));
  expect(stored.item.state).toBe("OPEN");
  await expect(
    command(
      "PERIOD_CREATE",
      newPeriod({ startDate: date(29), endDate: date(40) }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_PERIOD_OVERLAP" });
  await command(
    "PERIOD_CREATE",
    newPeriod({ startDate: date(30), endDate: date(60) }),
  );
  await expect(
    command("PERIOD_CREATE", newPeriod({ startDate: "2026-02-30" })),
  ).rejects.toThrow();
});
it("allows exactly one competing period insertion and leaves no failed receipt/audit", async () => {
  const key1 = crypto.randomUUID(),
    key2 = crypto.randomUUID();
  const body = newPeriod();
  const results = await Promise.allSettled([
    command("PERIOD_CREATE", body, key1),
    command("PERIOD_CREATE", body, key2),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.financePeriod.count({ where: { startDate: new Date(date(0)) } }),
  ).toBe(1);
  expect(
    await db.financeSetupReceipt.count({
      where: { actorId: people.owner.id, key: { in: [key1, key2] } },
    }),
  ).toBe(1);
});
it("amends and voids unused periods without deleting history, then permits a replacement", async () => {
  const body = newPeriod(),
    created = await command("PERIOD_CREATE", body);
  await command("PERIOD_UPDATE", {
    ...body,
    id: created.id,
    expectedVersion: 1,
    endDate: date(28),
  });
  await expect(
    command("PERIOD_VOID", {
      id: created.id,
      expectedVersion: 1,
      reason: "Stale void",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await command("PERIOD_VOID", {
    id: created.id,
    expectedVersion: 2,
    reason: "Correct unused period",
  });
  expect((await periodDetail(people.owner, created.id)).item.state).toBe(
    "VOID",
  );
  await command("PERIOD_CREATE", body);
  await expect(
    db.financePeriod.delete({ where: { id: created.id } }),
  ).rejects.toThrow();
});
it("locks used period dates and rejects close/reopen through the setup path", async () => {
  const body = newPeriod(),
    created = await command("PERIOD_CREATE", body);
  await db.financePeriod.update({
    where: { id: created.id },
    data: { usedAt: new Date() },
  });
  await expect(
    command("PERIOD_UPDATE", {
      ...body,
      id: created.id,
      expectedVersion: 1,
      endDate: date(28),
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PERIOD_USED" });
  await expect(
    command("PERIOD_VOID", {
      id: created.id,
      expectedVersion: 1,
      reason: "Cannot void used period",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PERIOD_USED" });
  await command("PERIOD_UPDATE", {
    ...body,
    id: created.id,
    expectedVersion: 1,
    name: "Updated period label",
  });
  await expect(
    db.financePeriod.update({
      where: { id: created.id },
      data: { usedAt: null },
    }),
  ).rejects.toThrow();
  await expect(
    db.financePeriod.update({
      where: { id: created.id },
      data: {
        state: "CLOSED",
        closedAt: new Date(),
        closedById: people.owner.id,
      },
    }),
  ).rejects.toThrow();
});
it("enforces period exclusion for direct SQL, not just serialized HTTP requests", async () => {
  await command("PERIOD_CREATE", newPeriod());
  await expect(
    db.financePeriod.create({
      data: {
        name: "Direct conflicting fixture",
        startDate: new Date(date(10)),
        endDate: new Date(date(40)),
      },
    }),
  ).rejects.toThrow();
});
it("paginates/filter counts consistently and rejects unrecognized query expressions", async () => {
  const name = `${codePrefix}.PAGE`;
  for (let i = 0; i < 3; i++)
    await command("ACCOUNT_CREATE", newAccount({ name }));
  const first = await accounts(people.selected, { q: name, pageSize: 2 });
  const second = await accounts(people.selected, {
    q: name,
    pageSize: 2,
    page: 2,
  });
  expect(first.total).toBe(3);
  expect(first.items).toHaveLength(2);
  expect(second.items).toHaveLength(1);
  expect(first.pages).toBe(2);
  expect(new Set([...first.items, ...second.items].map((a) => a.id)).size).toBe(
    3,
  );
  await expect(accounts(people.owner, { sort: "raw SQL" })).rejects.toThrow();
  await expect(periods(people.owner, { pageSize: 101 })).rejects.toThrow();
});
it("rechecks current ownership and session after provider proof", async () => {
  const stale = await proof();
  const source = await db.financeSettings.findFirstOrThrow();
  const transfer = await accessCommand(
    stale.actor,
    stale.proof,
    "TRANSFER",
    {
      targetId: people.selected.id,
      expectedVersion: source.version,
      reason: "Test owner handoff",
    },
    crypto.randomUUID(),
  );
  const next = await proof("selected");
  await accessCommand(
    next.actor,
    next.proof,
    "ACCEPT",
    {
      transferId: transfer.id,
      expectedVersion: 1,
      reason: "Accept setup responsibility",
    },
    crypto.randomUUID(),
  );
  await expect(command("ACCOUNT_CREATE", newAccount())).rejects.toMatchObject({
    code: "FINANCE_OWNER_REQUIRED",
  });
  const verified = await proof("selected");
  await db.session.deleteMany({
    where: { userId: people.selected.authUserId! },
  });
  await expect(
    setupCommand(
      people.selected,
      verified.proof,
      "ACCOUNT_CREATE",
      newAccount(),
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
});
it("has no Data API table/function permissions and keeps setup replay read-only", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(
      "REVOKE EXECUTE ON FUNCTION encova_finance_setup_command(UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,JSONB,TEXT,UUID) FROM encova_app",
    );
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
    for (const role of ["anon", "authenticated", "encova_app"]) {
      for (const query of [
        role === "encova_app"
          ? 'UPDATE "FinanceAccount" SET active=false'
          : 'SELECT * FROM "FinanceAccount"',
        role === "encova_app"
          ? 'DELETE FROM "FinancePeriod"'
          : 'SELECT * FROM "FinancePeriod"',
      ]) {
        await sql.query("BEGIN");
        await sql.query(`SET LOCAL ROLE ${role}`);
        await expect(sql.query(query)).rejects.toMatchObject({ code: "42501" });
        await sql.query("ROLLBACK");
      }
      if (role !== "encova_app") {
        await sql.query("BEGIN");
        await sql.query(`SET LOCAL ROLE ${role}`);
        await expect(
          sql.query(
            "SELECT encova_finance_setup_command(NULL,'supabase','',CURRENT_TIMESTAMP,'ACCOUNT_CREATE','{}','test-key',gen_random_uuid())",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await sql.query("ROLLBACK");
      }
    }
    const session = await auth.api.getSession({ headers: req().headers });
    await sql.query("BEGIN");
    await sql.query("SET LOCAL ROLE encova_app");
    const result = await sql.query(
      "SELECT encova_finance_setup_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'ACCOUNT_CREATE',$3::jsonb,$4,$5) AS result",
      [
        people.owner.id,
        session!.session.id,
        JSON.stringify(newAccount()),
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
it("uses private HTTP responses, strict bodies and safe conflict errors", async () => {
  const read = await setupRead(req(), "accounts");
  expect(read.status).toBe(200);
  expect(read.headers.get("cache-control")).toContain("no-store");
  const body = newAccount();
  const created = await setupMutation(
    req("owner", { ...body, reauth: { password } }),
    "ACCOUNT_CREATE",
  );
  expect(created.status).toBe(201);
  const duplicate = await setupMutation(
    req("owner", { ...body, reauth: { password } }),
    "ACCOUNT_CREATE",
  );
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.code).toBe(
    "FINANCE_ACCOUNT_CODE_EXISTS",
  );
  const invalid = await setupMutation(
    req("owner", { ...newAccount(), balance: "50.00", reauth: { password } }),
    "ACCOUNT_CREATE",
  );
  expect(invalid.status).toBe(422);
  env.FINANCE_ENABLED = false;
  try {
    expect((await setupRead(req(), "periods")).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("round-trips the NUMERIC(20,2) limit only after strict PKR string validation", async () => {
  const value = parsePkr("999999999999999999.99");
  const result = await db.$queryRaw<
    { amount: string }[]
  >`SELECT ${value}::numeric(20,2)::text AS amount`;
  expect(result[0].amount).toBe(value);
});
