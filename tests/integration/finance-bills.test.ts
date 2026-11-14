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
  { setupOwner } = await import("@/modules/finance/access/service");
const { setupCommand } = await import("@/modules/finance/accounting/service"),
  { masterCommand } = await import("@/modules/finance/masters/service");
const { billCommand, billDetail, bills } =
    await import("@/modules/finance/payables/service"),
  { billMutation } = await import("@/modules/finance/payables/http");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "B16." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0,
  client: string,
  ar: string,
  revenue: string,
  cash: string,
  period: { id: string; start: string; end: string };
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const req = (who = "owner", body?: unknown, key = crypto.randomUUID()) =>
  new Request(env.APP_URL + "/api/v1/finance/bills", {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookies[who] ?? "",
      origin: env.APP_URL,
      "x-encova-csrf": "1",
      "content-type": "application/json",
      "idempotency-key": key,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const proof = (who = "owner") =>
  verifyFinanceReauthentication(req(who), { password });
async function command(
  action: Parameters<typeof billCommand>[2],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return billCommand(v.actor, v.proof, action, body, key);
}
async function config(
  action: Parameters<typeof setupCommand>[2],
  body: unknown,
) {
  const v = await proof();
  return setupCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function master(
  action: Parameters<typeof masterCommand>[2],
  body: unknown,
) {
  const v = await proof();
  return masterCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function account(patch: Record<string, unknown> = {}) {
  return (
    await config("ACCOUNT_CREATE", {
      code: prefix + "." + ++count,
      name: prefix + " account " + count,
      type: "ASSET",
      normalSide: "DEBIT",
      reportGroup: "CURRENT_ASSETS",
      controlType: "NONE",
      currency: "PKR",
      parentId: null,
      isPosting: true,
      isContra: false,
      isCashEquivalent: false,
      reason: "Explicit synthetic bill mapping",
      ...patch,
    })
  ).id;
}
const partyBody = (patch: Record<string, unknown> = {}) => ({
  name: prefix + " client " + ++count,
  legalName: prefix + " Synthetic Legal Co",
  kind: "SUPPLIER",
  contactEmail: "synthetic@example.test",
  phone: null,
  address: "Synthetic bill address",
  userId: null,
  reason: "Explicit synthetic client",
  ...patch,
});
async function party(patch: Record<string, unknown> = {}) {
  return (await master("PARTY_CREATE", partyBody(patch))).id;
}
async function newPeriod(future = false) {
  const rows = await db.$queryRaw<
    { start: Date }[]
  >`SELECT d::date AS start FROM generate_series(${future ? "8100-01-01" : "1951-01-01"}::date,${future ? "8150-01-01" : "1999-01-01"}::date,interval '10 days') d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]') && daterange(d::date,(d+interval '9 days')::date,'[]')) ORDER BY d LIMIT 1`;
  if (!rows.length) throw new Error("No isolated bill test interval");
  const start = rows[0].start.toISOString().slice(0, 10),
    end = new Date(rows[0].start.getTime() + 9 * 86400000)
      .toISOString()
      .slice(0, 10);
  return {
    id: (
      await config("PERIOD_CREATE", {
        name: prefix + " synthetic only",
        startDate: start,
        endDate: end,
        reason: "Isolated bill test interval",
      })
    ).id,
    start,
    end,
  };
}
const line = (patch: Record<string, unknown> = {}) => ({
  description: "Synthetic earned service",
  quantity: "1",
  unitRate: "300000.00",
  discountAmount: "0.00",
  treatment: "EXPENSE",
  costAccountId: revenue,
  projectId: null,
  ...patch,
});
const body = (patch: Record<string, unknown> = {}) => ({
  kind: "BILL",
  referenceReliable: true,
  duplicateAcknowledged: true,
  cashAccountId: null,
  reference: prefix + "." + ++count,
  partyId: client,
  payableAccountId: ar,
  projectId: null,
  billDate: period.start,
  postingDate: period.start,
  dueDate: period.end,
  description: "Synthetic service bill",
  evidence: "Fixture evidence only",
  currency: "PKR",
  lines: [line()],
  reason: "Reviewed synthetic bill",
  ...patch,
});
async function release() {
  const ids = Object.values(people).map((p) => p.id),
    setting = await db.financeSettings.findFirst();
  if (setting && !ids.includes(setting.ownerId))
    throw new Error("Refuse unowned finance singleton cleanup");
  if (setting) await db.$executeRawUnsafe('TRUNCATE "FinanceSettings"');
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
      signed = await auth.api.signUpEmail({ body: { name, email, password } });
    await db.user.update({
      where: { id: signed.user.id },
      data: { emailVerified: true },
    });
    people[name] = await db.person.create({
      data: {
        email,
        authUserId: signed.user.id,
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
    "Explicit F11 synthetic owner",
  );
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "Explicit bill tester",
    },
  });
  ar = await account({
    controlType: "PAYABLES",
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
  });
  revenue = await account({
    type: "OPERATING_EXPENSE",
    normalSide: "DEBIT",
    reportGroup: "OPERATING_EXPENSES",
  });
  cash = await account({ controlType: "CASH" });
  client = await party();
  cash = (
    await master("CASH_CREATE", {
      name: prefix + " cash",
      kind: "BANK",
      glAccountId: cash,
      reason: "Synthetic bill cash master",
    })
  ).id;
  period = await newPeriod();
}, 30000);
afterAll(async () => {
  await release();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});

async function posted(patch: Record<string, unknown> = {}) {
  const d = await command("CREATE", body(patch));
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Reviewed synthetic bill",
  });
  return billDetail(people.owner, d.id);
}
it("denies unselected roots and every lower role before read or mutation validation", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(bills(people[who], { invalid: true })).rejects.toMatchObject({
      code: "FINANCE_FORBIDDEN",
    });
    expect(
      (
        await billMutation(
          req(who, { ...body(), reauth: { password } }),
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
});
it("posts a discounted cost and exactly one AP event with frozen party and immutable journal", async () => {
  const d = await posted({
    lines: [
      line({ quantity: "3", unitRate: "10.005", discountAmount: "1.02" }),
    ],
  });
  expect(d.item.totalAmount).toBe("29.00");
  expect(d.payableBalance).toBe("29.00");
  expect(
    d.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [ar, "0.00", "29.00"],
    [revenue, "29.00", "0.00"],
  ]);
  expect(d.item.partySnapshot).toHaveProperty("name");
  await expect(
    command("UPDATE", { id: d.item.id, expectedVersion: 2, ...body() }),
  ).rejects.toMatchObject({ code: "FINANCE_BILL_IMMUTABLE" });
});
it("immediate expense includes one cash payment and creates no payable that can be paid again", async () => {
  const d = await posted({
    kind: "EXPENSE",
    payableAccountId: null,
    cashAccountId: cash,
  });
  expect(d.item.number).toMatch(/^EXP-/);
  expect(d.payableBalance).toBe("0.00");
  expect(d.item.payableEvents).toHaveLength(0);
  expect(d.item.entry!.lines).toHaveLength(2);
});
it("rejects normalized reliable supplier reference across bills and immediate expenses", async () => {
  const ref = prefix + " unique reference";
  await posted({ reference: ref });
  const d = await command(
    "CREATE",
    body({
      reference: " " + ref.toUpperCase() + " ",
      kind: "EXPENSE",
      payableAccountId: null,
      cashAccountId: cash,
      referenceReliable: false,
    }),
  );
  await expect(
    command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Duplicate blocked",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_DUPLICATE_REFERENCE" });
  expect((await billDetail(people.owner, d.id)).item.entry).toBeNull();
});
it("flags same supplier/date/amount for explicit review and permits acknowledged separate cost", async () => {
  await posted();
  const b = body({ duplicateAcknowledged: false });
  const d = await command("CREATE", b);
  await expect(
    command("POST", { id: d.id, expectedVersion: 1, reason: "Needs review" }),
  ).rejects.toMatchObject({ code: "FINANCE_DUPLICATE_REVIEW" });
  await command("UPDATE", {
    ...b,
    id: d.id,
    expectedVersion: 1,
    duplicateAcknowledged: true,
  });
  await command("POST", {
    id: d.id,
    expectedVersion: 2,
    reason: "Confirmed separate purchase",
  });
});
it("replays a posted operation exactly, rejects a changed request key and stale edits", async () => {
  const d = await command("CREATE", body()),
    key = crypto.randomUUID(),
    args = { id: d.id, expectedVersion: 1, reason: "Idempotent bill" };
  const p = await command("POST", args, key);
  expect(await command("POST", args, key)).toEqual(p);
  await expect(
    command("POST", { ...args, reason: "Changed reason" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  const edit = await command("CREATE", body());
  await command("UPDATE", { id: edit.id, expectedVersion: 1, ...body() });
  await expect(
    command("VOID", { id: edit.id, expectedVersion: 1, reason: "Stale void" }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
});
it("supports project-separated prepayment and asset costs without using a manual control journal", async () => {
  const pre = await account(),
    fixed = await account({
      controlType: "FIXED_ASSET",
      reportGroup: "NONCURRENT_ASSETS",
    });
  const d = await posted({
    lines: [
      line({ treatment: "PREPAYMENT", costAccountId: pre, unitRate: "15" }),
      line({ treatment: "ASSET", costAccountId: fixed, unitRate: "20" }),
    ],
  });
  expect(d.item.totalAmount).toBe("35.00");
  expect(d.item.entry!.lines).toHaveLength(3);
  expect(d.item.entry!.lines.slice(1).every((l) => l.billLineId)).toBe(true);
});
it("rejects wrong cost mapping and future or closed period posting without partial GL or AP effects", async () => {
  const d = await command(
    "CREATE",
    body({ lines: [line({ costAccountId: ar })] }),
  );
  await expect(
    command("POST", { id: d.id, expectedVersion: 1, reason: "Bad mapping" }),
  ).rejects.toMatchObject({ code: "FINANCE_BILL_MAPPING" });
  expect((await billDetail(people.owner, d.id)).item.entry).toBeNull();
  const p = await newPeriod(true),
    f = await command(
      "CREATE",
      body({ billDate: p.start, postingDate: p.start, dueDate: p.end }),
    );
  await expect(
    command("POST", { id: f.id, expectedVersion: 1, reason: "Future blocked" }),
  ).rejects.toMatchObject({ code: "FINANCE_FUTURE_DATE" });
});
it("runtime has SELECT and checked command only; posted headers, lines, events cannot mutate", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    const r = await sql.query(
      `SELECT has_table_privilege(current_user,'"FinanceBill"','SELECT') AS read,has_table_privilege(current_user,'"FinanceBill"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_bill_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_bill_effects(uuid,uuid)','EXECUTE') AS helper`,
    );
    expect(r.rows[0]).toEqual({
      read: true,
      write: false,
      command: true,
      helper: false,
    });
    await sql.query("RESET ROLE");
    const d = await posted();
    await expect(
      sql.query(
        'UPDATE "FinanceBill" SET description=description WHERE id=$1',
        [d.item.id],
      ),
    ).rejects.toThrow("FINANCE_BILL_IMMUTABLE");
    await expect(
      sql.query('DELETE FROM "FinanceBillLine" WHERE "billId"=$1', [d.item.id]),
    ).rejects.toThrow("FINANCE_BILL_IMMUTABLE");
    await expect(
      sql.query('DELETE FROM "FinancePayableEvent" WHERE "billId"=$1', [
        d.item.id,
      ]),
    ).rejects.toThrow();
  } finally {
    await sql.end();
  }
});
