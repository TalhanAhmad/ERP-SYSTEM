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
const { billCommand, billDetail } =
  await import("@/modules/finance/payables/service");
const { movementCommand, movementDetail, movements, cashRegister } =
  await import("@/modules/finance/treasury/service");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "F21." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

async function move(
  action: Parameters<typeof movementCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return movementCommand(v.actor, v.proof, action, input, key);
}
async function banks() {
  const make = async () => {
    const gl = await account({ controlType: "CASH" });
    const b = await master("CASH_CREATE", {
      name: prefix + " bank " + ++count,
      kind: "BANK",
      glAccountId: gl,
      reason: "Synthetic transfer cash master",
    });
    return { id: b.id, gl };
  };
  return { a: await make(), b: await make() };
}
const day = (n: number) =>
  new Date(new Date(period.start).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

async function funding(patch: Record<string, unknown> = {}) {
  const bank = (await banks()).a,
    p = await party({ kind: "OTHER" }),
    control = await account({
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
      controlType: "CAPITAL",
    });
  return {
    kind: "CAPITAL_CONTRIBUTION",
    reference: prefix + "." + ++count,
    documentDate: period.start,
    postingDate: period.start,
    description: "Synthetic company funding",
    evidence: "Reviewed funding evidence",
    currency: "PKR",
    amount: "200.00",
    fromCashId: null,
    toCashId: bank.id,
    partyId: p,
    controlAccountId: control,
    counterAccountId: null,
    projectId: null,
    approvalEvidence: null,
    billId: null,
    reason: "Synthetic approved funding",
    ...patch,
  };
}
async function postFunding(b: Record<string, unknown>) {
  const d = await move("CREATE", b);
  await move("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post reviewed funding",
  });
  return movementDetail(people.owner, d.id);
}
it("capital is equity with a real cash leg, snapshots and private contributor balances", async () => {
  const b = await funding(),
    d = await postFunding(b),
    lines = d.item.entry!.lines;
  expect(lines.find((l) => l.accountId === b.controlAccountId)?.credit).toBe(
    "200.00",
  );
  expect(lines.every((l) => l.accountId !== revenue)).toBe(true);
  expect(
    (
      await db.financeFundingEvent.findUniqueOrThrow({
        where: { movementId: d.item.id },
      })
    ).bucket,
  ).toBe("CAPITAL");
  expect(
    (await movements(people.owner, { family: "TRANSFERS", q: b.reference }))
      .total,
  ).toBe(0);
  expect(
    (await movements(people.owner, { family: "FUNDING", q: b.reference }))
      .total,
  ).toBe(1);
});
it("capital returns require approval and cannot exceed dated contributor capital", async () => {
  const b = await funding();
  await postFunding(b);
  const ret = {
    ...b,
    kind: "CAPITAL_RETURN",
    fromCashId: b.toCashId,
    toCashId: null,
    amount: "75.01",
    approvalEvidence: "Company authorization",
  };
  await expect(
    move("CREATE", { ...ret, approvalEvidence: null }),
  ).rejects.toThrow();
  await postFunding(ret);
  const over = await move("CREATE", { ...ret, amount: "125.00" });
  await expect(
    move("POST", { id: over.id, expectedVersion: 1, reason: "Over return" }),
  ).rejects.toMatchObject({ code: "FINANCE_FUNDING_CAPACITY" });
  expect(
    await db.financeJournalEntry.count({ where: { movementId: over.id } }),
  ).toBe(0);
});
it("approved distributions are separate from capital and carry authorization evidence", async () => {
  const control = await account({
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
      controlType: "DISTRIBUTION",
    }),
    b = await funding(),
    d = await postFunding({
      ...b,
      kind: "DISTRIBUTION",
      fromCashId: b.toCashId,
      toCashId: null,
      controlAccountId: control,
      approvalEvidence: "Explicit board evidence",
    });
  expect(d.item.approvalEvidence).toBe("Explicit board evidence");
  expect(d.item.entry!.lines.find((l) => l.accountId === control)?.debit).toBe(
    "200.00",
  );
  expect(
    (
      await db.financeFundingEvent.findUniqueOrThrow({
        where: { movementId: d.item.id },
      })
    ).bucket,
  ).toBe("DISTRIBUTION");
});
it("reviewed noncash contributions debit the selected asset and never enter cash totals", async () => {
  const b = await funding(),
    asset = await account({ controlType: "FIXED_ASSET" }),
    d = await postFunding({
      ...b,
      kind: "NONCASH_CAPITAL",
      toCashId: null,
      counterAccountId: asset,
      approvalEvidence: "Noncash value reviewed",
    });
  expect(d.item.entry!.lines.find((l) => l.accountId === asset)?.debit).toBe(
    "200.00",
  );
  expect((await cashRegister(people.owner, { q: b.reference })).total).toBe(0);
});
it("founder outlays and capped reimbursements clear a liability without a second expense", async () => {
  const b = await funding(),
    payable = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "FOUNDER_PAYABLE",
    }),
    out = {
      ...b,
      kind: "FOUNDER_OUTLAY",
      toCashId: null,
      controlAccountId: payable,
      counterAccountId: revenue,
    },
    d = await postFunding(out);
  expect(d.item.entry!.lines.find((l) => l.accountId === revenue)?.debit).toBe(
    "200.00",
  );
  const refund = {
      ...b,
      kind: "FOUNDER_REIMBURSEMENT",
      fromCashId: b.toCashId,
      toCashId: null,
      controlAccountId: payable,
      amount: "150.00",
    },
    r = await postFunding(refund);
  expect(r.item.entry!.lines.every((l) => l.accountId !== revenue)).toBe(true);
  const over = await move("CREATE", { ...refund, amount: "50.01" });
  await expect(
    move("POST", {
      id: over.id,
      expectedVersion: 1,
      reason: "Excess reimbursement",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FUNDING_CAPACITY" });
  await expect(
    move("REVERSE", {
      id: d.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Consumed outlay",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FUNDING_CAPACITY" });
});
it("founder-paid company bills clear the original AP and retain the supplier identity", async () => {
  const bill = await posted({ lines: [line({ unitRate: "90.00" })] }),
    b = await funding(),
    payable = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "FOUNDER_PAYABLE",
    }),
    d = await postFunding({
      ...b,
      kind: "FOUNDER_BILL_SETTLEMENT",
      toCashId: null,
      controlAccountId: payable,
      counterAccountId: ar,
      billId: bill.item.id,
      amount: "90.00",
    });
  expect((await billDetail(people.owner, bill.item.id)).payableBalance).toBe(
    "0.00",
  );
  const ap = d.item.entry!.lines.find((l) => l.accountId === ar)!;
  expect(ap.debit).toBe("90.00");
  expect(ap.partyId).toBe(client);
  expect(d.item.entry!.lines.every((l) => l.accountId !== revenue)).toBe(true);
  await move("REVERSE", {
    id: d.item.id,
    expectedVersion: 2,
    postingDate: period.start,
    reason: "Reverse personal settlement",
  });
  expect((await billDetail(people.owner, bill.item.id)).payableBalance).toBe(
    "90.00",
  );
});
it("backdating cannot consume funds reserved by later reimbursements and reversals preserve GL", async () => {
  const b = await funding(),
    payable = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "FOUNDER_PAYABLE",
    });
  await postFunding({
    ...b,
    kind: "FOUNDER_OUTLAY",
    toCashId: null,
    controlAccountId: payable,
    counterAccountId: revenue,
  });
  const refund = {
    ...b,
    kind: "FOUNDER_REIMBURSEMENT",
    fromCashId: b.toCashId,
    toCashId: null,
    controlAccountId: payable,
    amount: "150.00",
    postingDate: day(2),
  };
  const paid = await postFunding(refund);
  const back = await move("CREATE", {
    ...refund,
    amount: "60.00",
    postingDate: day(1),
  });
  await expect(
    move("POST", {
      id: back.id,
      expectedVersion: 1,
      reason: "Backdated overuse",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FUNDING_CAPACITY" });
  const result = await move("REVERSE", {
    id: paid.item.id,
    expectedVersion: 2,
    postingDate: day(3),
    reason: "Undo reimbursement",
  });
  expect(
    (
      await movementDetail(people.owner, result.reversalId!)
    ).item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual(
    paid.item.entry!.lines.map((l) => [l.accountId, l.credit, l.debit]),
  );
});
it("evidence, current mappings, currency and control classification are enforced", async () => {
  const b = await funding(),
    bad = await move("CREATE", { ...b, controlAccountId: revenue });
  await expect(
    move("POST", { id: bad.id, expectedVersion: 1, reason: "Wrong mapping" }),
  ).rejects.toMatchObject({ code: "FINANCE_MOVEMENT_MAPPING" });
  await expect(move("CREATE", { ...b, currency: "USD" })).rejects.toThrow();
  for (const who of ["hr", "member", "other"])
    await expect(
      movements(people[who], { family: "FUNDING" }),
    ).rejects.toMatchObject({ status: 403 });
});
it("idempotent source posting and immutable funding events survive retries", async () => {
  const b = await funding(),
    d = await move("CREATE", b),
    input = { id: d.id, expectedVersion: 1, reason: "Concurrent funding" },
    key = crypto.randomUUID(),
    r = await Promise.all([move("POST", input, key), move("POST", input, key)]);
  expect(r[0]).toEqual(r[1]);
  expect(
    await db.financeFundingEvent.count({ where: { movementId: d.id } }),
  ).toBe(1);
  await expect(
    db.$executeRaw`UPDATE "FinanceFundingEvent" SET amount=amount+1 WHERE "movementId"=${d.id}::uuid`,
  ).rejects.toThrow();
});

it("contributor lookup includes private OTHER parties and bounded balances retain separate returns", async () => {
  const { invoiceOptions } =
      await import("@/modules/finance/receivables/options"),
    { fundingBalances } = await import("@/modules/finance/funding/service");
  const b = await funding();
  await postFunding(b);
  const p = await db.financeParty.findUniqueOrThrow({
    where: { id: b.partyId as string },
  });
  expect(
    (
      await invoiceOptions(people.owner, { kind: "contributor", q: p.name })
    ).items.some((i) => i.id === p.id),
  ).toBe(true);
  await postFunding({
    ...b,
    kind: "CAPITAL_RETURN",
    toCashId: null,
    fromCashId: b.toCashId,
    amount: "25.15",
    approvalEvidence: "Authorized return",
  });
  const v = await fundingBalances(people.owner, { q: p.name }),
    row = v.items.find((i) => i.partyId === p.id)!;
  expect(row.contributions).toBe("200.00");
  expect(row.returns).toBe("25.15");
  expect(row.capital).toBe("174.85");
  expect(v.items.length).toBeLessThanOrEqual(25);
});
