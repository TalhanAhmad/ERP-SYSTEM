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
const { movementCommand, movementDetail } =
  await import("@/modules/finance/treasury/service");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "I24." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0,
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
  await account({
    controlType: "PAYABLES",
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
  });
  await account({
    type: "OPERATING_EXPENSE",
    normalSide: "DEBIT",
    reportGroup: "OPERATING_EXPENSES",
  });
  cash = await account({ controlType: "CASH" });
  await party();
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

const { holdingCommand, holdingDetail } =
  await import("@/modules/finance/investments/service");
async function register(
  action: Parameters<typeof holdingCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return holdingCommand(v.actor, v.proof, action, input, key);
}
async function holding(patch: Record<string, unknown> = {}) {
  const p = await party({ kind: "OTHER" }),
    control = await account({ controlType: "INVESTMENT" }),
    incomeControl = await account({
      controlType: "INVESTMENT_INCOME_RECEIVABLE",
    }),
    income = await account({
      type: "OTHER_INCOME",
      normalSide: "CREDIT",
      reportGroup: "OTHER_INCOME",
    }),
    expense = await account({
      type: "OTHER_EXPENSE",
      normalSide: "DEBIT",
      reportGroup: "OTHER_EXPENSES",
    }),
    body = {
      name: prefix + " holding " + ++count,
      partyId: p,
      investmentType: "Synthetic fund",
      unitMode: "UNIT",
      classification: "CURRENT",
      policyStatus: "REVIEWED",
      measurementMode: "MANUAL_VALUATION",
      valuationTreatment: "PROFIT_LOSS",
      policy:
        "Explicit synthetic reviewed policy, manual values and separate income",
      evidence: "Synthetic review evidence",
      investmentAccountId: control,
      gainAccountId: income,
      lossAccountId: expense,
      feeAccountId: expense,
      incomeAccountId: income,
      incomeControlAccountId: incomeControl,
      valuationOffsetAccountId: income,
      impairmentAccountId: expense,
      reason: "Reviewed synthetic holding",
      ...patch,
    };
  return { ...(await register("CREATE", body)), body };
}
function acquisition(
  h: { id: string; body: { unitMode: string } },
  bank: string,
  patch: Record<string, unknown> = {},
) {
  return {
    kind: "INVESTMENT_ACQUISITION",
    holdingId: h.id,
    units: h.body.unitMode === "UNIT" ? "3.000001" : null,
    fromCashId: bank,
    amount: "100.01",
    reference: prefix + "." + ++count,
    documentDate: period.start,
    postingDate: period.start,
    description: "Synthetic company acquisition",
    evidence: "Reviewed acquisition and bank evidence",
    currency: "PKR",
    reason: "Reviewed acquisition",
    ...patch,
  };
}
async function postAcquisition(body: Record<string, unknown>) {
  const d = await move("CREATE", body);
  await move("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post investment acquisition",
  });
  return movementDetail(people.owner, d.id);
}

async function acquired(patch: Record<string, unknown> = {}) {
  const h = await holding(patch),
    bank = (await banks()).a,
    d = await postAcquisition(
      acquisition(h, bank.id, {
        amount: "100.01",
        units: h.body.unitMode === "UNIT" ? "3.000000" : null,
      }),
    ),
    lot = await db.financeInvestmentLot.findUniqueOrThrow({
      where: { movementId: d.item.id },
    });
  return { h, bank, d, lot };
}
const allocation = (lotId: string, patch: Record<string, unknown> = {}) => ({
  lotId,
  units: null,
  carryingAmount: null,
  disposeAll: false,
  ...patch,
});
function investment(
  h: { id: string },
  bank: string | null,
  patch: Record<string, unknown> = {},
) {
  return {
    kind: "INVESTMENT_DISPOSAL",
    holdingId: h.id,
    toCashId: bank,
    amount: "50.00",
    feeAmount: "1.00",
    allocations: [],
    reference: prefix + "." + ++count,
    documentDate: period.start,
    postingDate: period.start,
    description: "Reviewed synthetic investment movement",
    evidence: "Reviewed source and approval evidence",
    currency: "PKR",
    reason: "Reviewed investment transaction",
    ...patch,
  };
}
async function postInvestment(body: Record<string, unknown>) {
  const d = await move("CREATE", body);
  await move("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post reviewed investment source",
  });
  return movementDetail(people.owner, d.id);
}
it("partial unit disposal removes exact proportional carrying and cost, with separate fees/gross gain and actual bank net", async () => {
  const { h, bank, lot } = await acquired(),
    d = await postInvestment(
      investment(h, bank.id, {
        allocations: [allocation(lot.id, { units: "1" })],
      }),
    ),
    lines = d.item.entry!.lines;
  expect(d.item.investmentAllocations[0]).toMatchObject({
    costBasis: "33.34",
    carryingBasis: "33.34",
    unitBasis: "1.000000",
  });
  expect(lines.find((l) => l.accountId === bank.gl)?.debit).toBe("49.00");
  expect(
    lines.find((l) => l.accountId === h.body.feeAccountId && l.sequence === 2)
      ?.debit,
  ).toBe("1.00");
  expect(lines.find((l) => l.accountId === h.body.gainAccountId)?.credit).toBe(
    "16.66",
  );
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    originalCost: "66.67",
    carryingValue: "66.67",
    units: "2.000000",
    realizedResult: "16.66",
    fees: "1.00",
  });
});
it("final unit disposal removes the exact final paisa and amount-based disposals support partial/full basis", async () => {
  for (const unitMode of ["UNIT", "AMOUNT"]) {
    const { h, bank, lot } = await acquired({ unitMode });
    await postInvestment(
      investment(h, bank.id, {
        amount: "10.00",
        feeAmount: "0.00",
        allocations: [
          allocation(
            lot.id,
            unitMode === "UNIT" ? { units: "1" } : { carryingAmount: "33.34" },
          ),
        ],
      }),
    );
    const final = await postInvestment(
      investment(h, bank.id, {
        amount: "80.00",
        feeAmount: "0.00",
        allocations: [allocation(lot.id, { disposeAll: true })],
      }),
    );
    expect(final.item.investmentAllocations[0].carryingBasis).toBe("66.67");
    expect(await holdingDetail(people.owner, h.id)).toMatchObject({
      originalCost: "0.00",
      carryingValue: "0.00",
    });
  }
});
it("over-disposal, cross-holding lots and earlier-than-latest lot dates reject without partial source or GL", async () => {
  const { h, bank, lot } = await acquired(),
    other = await holding();
  await expect(
    move(
      "CREATE",
      investment(h, bank.id, {
        allocations: [allocation(lot.id, { units: "3.000001" })],
      }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_CAPACITY" });
  await expect(
    move(
      "CREATE",
      investment(other, bank.id, {
        allocations: [allocation(lot.id, { disposeAll: true })],
      }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_MAPPING" });
  await postInvestment(
    investment(h, bank.id, {
      postingDate: day(2),
      allocations: [allocation(lot.id, { units: "1" })],
    }),
  );
  await expect(
    move(
      "CREATE",
      investment(h, bank.id, {
        postingDate: day(1),
        allocations: [allocation(lot.id, { units: "1" })],
      }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_DATE_ORDER" });
});
it("lot changes invalidate an older draft and a reviewed save refreshes its basis before posting", async () => {
  const { h, bank, lot } = await acquired(),
    body = investment(h, bank.id, {
      allocations: [allocation(lot.id, { units: "1" })],
    }),
    draft = await move("CREATE", body);
  await postInvestment(
    investment(h, bank.id, {
      allocations: [allocation(lot.id, { units: "1" })],
    }),
  );
  await expect(
    move("POST", {
      id: draft.id,
      expectedVersion: 1,
      reason: "Stale selected lot",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_STALE_LOT" });
  expect(
    await db.financeJournalEntry.count({ where: { movementId: draft.id } }),
  ).toBe(0);
  await move("UPDATE", { ...body, id: draft.id, expectedVersion: 1 });
  await move("POST", {
    id: draft.id,
    expectedVersion: 2,
    reason: "Post refreshed reviewed lot",
  });
  expect((await holdingDetail(people.owner, h.id)).units).toBe("1.000000");
});
it("two competing full-lot drafts cannot dispose more than the remaining holding", async () => {
  const { h, bank, lot } = await acquired(),
    b = investment(h, bank.id, {
      allocations: [allocation(lot.id, { disposeAll: true })],
    }),
    drafts = await Promise.all([move("CREATE", b), move("CREATE", b)]),
    results = await Promise.allSettled(
      drafts.map((d) =>
        move("POST", {
          id: d.id,
          expectedVersion: 1,
          reason: "Competing full disposal",
        }),
      ),
    );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await holdingDetail(people.owner, h.id)).carryingValue).toBe("0.00");
});
it("manual valuation and impairment change carrying only and retain distinct results under reviewed policy", async () => {
  const { h, lot } = await acquired(),
    up = investment(h, null, {
      kind: "INVESTMENT_VALUATION_UP",
      amount: "20.00",
      feeAmount: "0.00",
      approvalEvidence: "Reviewed manual valuation",
      allocations: [allocation(lot.id, { carryingAmount: "20.00" })],
    });
  await postInvestment(up);
  await postInvestment({
    ...up,
    kind: "INVESTMENT_VALUATION_DOWN",
    amount: "5.01",
    allocations: [allocation(lot.id, { carryingAmount: "5.01" })],
  });
  await postInvestment({
    ...up,
    kind: "INVESTMENT_IMPAIRMENT",
    amount: "4.00",
    allocations: [allocation(lot.id, { carryingAmount: "4.00" })],
  });
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    originalCost: "100.01",
    carryingValue: "111.00",
    valuationChanges: "14.99",
    impairments: "4.00",
    realizedResult: "0.00",
  });
});
it("cost policy blocks valuation guesses, explicit impairment cannot exceed carrying, and unsupported future dates roll back", async () => {
  const { h, lot } = await acquired({
      measurementMode: "COST",
      valuationOffsetAccountId: null,
    }),
    b = investment(h, null, {
      kind: "INVESTMENT_VALUATION_UP",
      amount: "1.00",
      feeAmount: "0.00",
      approvalEvidence: "Reviewed manual adjustment",
      allocations: [allocation(lot.id, { carryingAmount: "1.00" })],
    }),
    d = await move("CREATE", b);
  await expect(
    move("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Unconfigured valuation policy",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_POLICY" });
  await expect(
    move("CREATE", {
      ...b,
      kind: "INVESTMENT_IMPAIRMENT",
      amount: "100.02",
      allocations: [allocation(lot.id, { carryingAmount: "100.02" })],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_CAPACITY" });
});
it("cash income, accrual and later settlement are distinct and settlement cannot create duplicate income", async () => {
  const h = await holding(),
    bank = (await banks()).a,
    b = investment(h, bank.id, {
      kind: "INVESTMENT_INCOME_RECEIPT",
      amount: "10.01",
      feeAmount: "0.00",
    });
  await postInvestment(b);
  await postInvestment({
    ...b,
    kind: "INVESTMENT_INCOME_ACCRUAL",
    toCashId: null,
    amount: "20.00",
  });
  const settled = await postInvestment({
    ...b,
    kind: "INVESTMENT_INCOME_SETTLEMENT",
    amount: "7.50",
  });
  expect(
    settled.item.entry!.lines.find(
      (l) => l.accountId === h.body.incomeControlAccountId,
    )?.credit,
  ).toBe("7.50");
  expect(
    settled.item.entry!.lines.some(
      (l) => l.accountId === h.body.incomeAccountId,
    ),
  ).toBe(false);
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    incomeEarned: "30.01",
    incomeReceivable: "12.50",
    originalCost: "0.00",
  });
  const over = await move("CREATE", {
    ...b,
    kind: "INVESTMENT_INCOME_SETTLEMENT",
    amount: "12.51",
  });
  await expect(
    move("POST", {
      id: over.id,
      expectedVersion: 1,
      reason: "Excess income settlement",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_INCOME_CAPACITY" });
});
it("reversals retain actual disposal legs and lot history, while a consumed acquisition cannot be removed", async () => {
  const { h, bank, lot, d } = await acquired(),
    sale = await postInvestment(
      investment(h, bank.id, {
        allocations: [allocation(lot.id, { units: "1" })],
      }),
    );
  await expect(
    move("REVERSE", {
      id: d.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Consumed acquisition",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_CAPACITY" });
  const r = await move("REVERSE", {
    id: sale.item.id,
    expectedVersion: 2,
    postingDate: period.start,
    reason: "Reverse reviewed sale",
  });
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    originalCost: "100.01",
    carryingValue: "100.01",
    units: "3.000000",
    realizedResult: "0.00",
    fees: "0.00",
  });
  expect(
    (await movementDetail(people.owner, r.reversalId!)).item.entry!.lines.map(
      (l) => [l.accountId, l.debit, l.credit],
    ),
  ).toEqual(
    sale.item.entry!.lines.map((l) => [l.accountId, l.credit, l.debit]),
  );
});
it("fully impaired zero-proceeds retirement preserves basis history without inventing a zero-value journal", async () => {
  const { h, lot } = await acquired({ unitMode: "AMOUNT" });
  await postInvestment(
    investment(h, null, {
      kind: "INVESTMENT_IMPAIRMENT",
      amount: "100.01",
      feeAmount: "0.00",
      approvalEvidence: "Reviewed full impairment",
      allocations: [allocation(lot.id, { carryingAmount: "100.01" })],
    }),
  );
  const retired = await postInvestment(
    investment(h, null, {
      amount: "0.00",
      feeAmount: "0.00",
      allocations: [allocation(lot.id, { disposeAll: true })],
    }),
  );
  expect(retired.item.entry).toBeNull();
  expect(retired.item.registerOnly).toBe(true);
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    originalCost: "0.00",
    carryingValue: "0.00",
    impairments: "100.01",
  });
  await move("REVERSE", {
    id: retired.item.id,
    expectedVersion: 2,
    postingDate: period.start,
    reason: "Restore zero-carrying basis",
  });
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    originalCost: "100.01",
    carryingValue: "0.00",
  });
});
it("fees above gross proceeds create the actual outgoing cash leg once", async () => {
  const { h, bank, lot } = await acquired(),
    d = await postInvestment(
      investment(h, bank.id, {
        amount: "1.00",
        feeAmount: "2.00",
        allocations: [allocation(lot.id, { units: "1" })],
      }),
    );
  expect(d.item.entry!.lines.find((l) => l.accountId === bank.gl)?.credit).toBe(
    "1.00",
  );
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    realizedResult: "-32.34",
    fees: "2.00",
  });
});
it("source request hashing preserves no-op defaults for prior permanent receipts", async () => {
  const { movementSchemas } =
      await import("@/modules/finance/treasury/schemas"),
    bank = (await banks()).a,
    other = (await banks()).a,
    body = {
      kind: "TRANSFER",
      fromCashId: bank.id,
      toCashId: other.id,
      amount: "1.01",
      reference: prefix + " legacy",
      documentDate: period.start,
      postingDate: period.start,
      description: "Legacy transfer",
      evidence: "Legacy fixture evidence",
      reason: "Legacy-compatible request",
    },
    normalized = movementSchemas.CREATE.parse(body),
    { feeAmount, allocations, ...legacy } = normalized;
  expect(feeAmount).toBe("0.00");
  expect(allocations).toEqual([]);
  const hashes = await db.$queryRaw<
    { old: string; current: string }[]
  >`SELECT encode(sha256(convert_to(jsonb_strip_nulls(${JSON.stringify(legacy)}::jsonb)::text,'UTF8')),'hex') AS old,encova_finance_movement_digest(${JSON.stringify(normalized)}::jsonb) AS current`;
  expect(hashes[0].old).toBe(hashes[0].current);
});

it("acquisition reversal cannot strand an upward valuation after original units and cost are removed", async () => {
  const { h, lot, d } = await acquired();
  await postInvestment(
    investment(h, null, {
      kind: "INVESTMENT_VALUATION_UP",
      amount: "10.00",
      feeAmount: "0.00",
      approvalEvidence: "Reviewed manual value",
      allocations: [allocation(lot.id, { carryingAmount: "10.00" })],
    }),
  );
  await expect(
    move("REVERSE", {
      id: d.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Would strand unrealized value",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_CAPACITY" });
  expect((await holdingDetail(people.owner, h.id)).carryingValue).toBe(
    "110.01",
  );
});
it("cash income alone freezes the reviewed policy and preserves source snapshots", async () => {
  const h = await holding(),
    bank = (await banks()).a;
  await postInvestment(
    investment(h, bank.id, {
      kind: "INVESTMENT_INCOME_RECEIPT",
      amount: "5.00",
      feeAmount: "0.00",
    }),
  );
  expect((await holdingDetail(people.owner, h.id)).item.usedAt).not.toBeNull();
  await expect(
    register("UPDATE", {
      ...h.body,
      id: h.id,
      expectedVersion: 1,
      policy: "Changed after income",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_HOLDING_TERMS_USED" });
});

it("register-only retirement still rejects future posting and cannot bypass source period rules", async () => {
  const { h, lot } = await acquired({ unitMode: "AMOUNT" });
  await postInvestment(
    investment(h, null, {
      kind: "INVESTMENT_IMPAIRMENT",
      amount: "100.01",
      feeAmount: "0.00",
      approvalEvidence: "Reviewed impairment",
      allocations: [allocation(lot.id, { carryingAmount: "100.01" })],
    }),
  );
  const future = await newPeriod(true),
    d = await move(
      "CREATE",
      investment(h, null, {
        amount: "0.00",
        feeAmount: "0.00",
        documentDate: future.start,
        postingDate: future.start,
        allocations: [allocation(lot.id, { disposeAll: true })],
      }),
    );
  await expect(
    move("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Future retirement attempt",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FUTURE_DATE" });
  expect((await holdingDetail(people.owner, h.id)).originalCost).toBe("100.01");
});
it("private lot bases and income events are immutable and runtime cannot bypass checked commands", async () => {
  const { h, bank, lot } = await acquired(),
    sale = await postInvestment(
      investment(h, bank.id, {
        allocations: [allocation(lot.id, { units: "1" })],
      }),
    );
  await expect(
    db.$executeRaw`DELETE FROM "FinanceInvestmentAllocation" WHERE "movementId"=${sale.item.id}::uuid`,
  ).rejects.toThrow("FINANCE_MOVEMENT_IMMUTABLE");
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    expect(
      (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceInvestmentAllocation"','SELECT') AS read,has_table_privilege(current_user,'"FinanceInvestmentAllocation"','INSERT') AS write,has_table_privilege(current_user,'"FinanceInvestmentIncomeEvent"','UPDATE') AS eventwrite,has_function_privilege(current_user,'encova_finance_investment_set_allocations(uuid,jsonb)','EXECUTE') AS helper`,
        )
      ).rows[0],
    ).toEqual({ read: true, write: false, eventwrite: false, helper: false });
  } finally {
    await sql.end();
  }
});
