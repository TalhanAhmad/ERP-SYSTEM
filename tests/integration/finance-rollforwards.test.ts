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
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "RF37." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0;

const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const req = (who = "owner", body?: unknown, key = crypto.randomUUID()) =>
  new Request(env.APP_URL + "/api/v1/finance/projects", {
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
}, 30000);
afterAll(async () => {
  await release();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});

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

const { rollforward, rollforwardHistory, postedSource } =
  await import("@/modules/finance/reports/rollforwards/service");
const { movementCommand } = await import("@/modules/finance/treasury/service");
const { loanCommand } = await import("@/modules/finance/funding/loans/service");
const { holdingCommand } =
  await import("@/modules/finance/investments/service");
const { assetCommand } = await import("@/modules/finance/assets/service");
const { assetMovementCommand } =
  await import("@/modules/finance/assets/lifecycle/service");
const { invoiceCommand } =
  await import("@/modules/finance/receivables/service");
const { billCommand } = await import("@/modules/finance/payables/service");
const { customerCommand } =
  await import("@/modules/finance/receivables/customer/service");
const { ledgerCommand } = await import("@/modules/finance/ledger/service");
const plus = (d: string, n: number) =>
  new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
async function move(
  action: Parameters<typeof movementCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return movementCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function assetMove(
  action: Parameters<typeof assetMovementCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return assetMovementCommand(
    v.actor,
    v.proof,
    action,
    input,
    crypto.randomUUID(),
  );
}
async function inv(
  action: Parameters<typeof invoiceCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return invoiceCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function bill(action: Parameters<typeof billCommand>[2], input: unknown) {
  const v = await proof();
  return billCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function customer(
  resource: Parameters<typeof customerCommand>[2],
  action: Parameters<typeof customerCommand>[3],
  input: unknown,
) {
  const v = await proof();
  return customerCommand(
    v.actor,
    v.proof,
    resource,
    action,
    input,
    crypto.randomUUID(),
  );
}
async function journal(
  action: Parameters<typeof ledgerCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return ledgerCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function party(kind = "OTHER") {
  return (
    await master("PARTY_CREATE", {
      name: prefix + " party " + ++count,
      legalName: "Synthetic Legal Co",
      kind,
      reason: "Reviewed synthetic source identity",
    })
  ).id;
}
async function bank() {
  const gl = await account({ controlType: "CASH" });
  return {
    id: (
      await master("CASH_CREATE", {
        name: prefix + " bank " + ++count,
        kind: "BANK",
        glAccountId: gl,
        reason: "Reviewed synthetic cash source",
      })
    ).id,
    gl,
  };
}
async function post(p: { start: string }, patch: Record<string, unknown>) {
  const d = await move("CREATE", {
    reference: prefix + " movement " + ++count,
    documentDate: p.start,
    postingDate: p.start,
    description: "Actual reviewed report source",
    evidence: "Synthetic actual posting evidence",
    reason: "Actual typed source posting",
    ...patch,
  });
  await move("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual typed source",
  });
  return d;
}
const report = (kind: string, p: { start: string; end: string }, extra = {}) =>
  rollforward(people.owner, kind, { from: p.start, to: p.end, ...extra });
async function funding() {
  const p = await newPeriod(),
    b = await bank(),
    contributor = await party(),
    capital = await account({
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
      controlType: "CAPITAL",
    }),
    name = (
      await db.financeParty.findUniqueOrThrow({ where: { id: contributor } })
    ).name;
  return { p, b, contributor, capital, name };
}
async function loan(p: { start: string; end: string }, direction = "RECEIVED") {
  const received = direction === "RECEIVED",
    partyId = await party(),
    principal = await account({
      type: received ? "LIABILITY" : "ASSET",
      normalSide: received ? "CREDIT" : "DEBIT",
      reportGroup: received ? "CURRENT_LIABILITIES" : "CURRENT_ASSETS",
      controlType: received ? "LOAN_PAYABLE" : "LOAN_RECEIVABLE",
    }),
    interest = await account({
      type: received ? "LIABILITY" : "ASSET",
      normalSide: received ? "CREDIT" : "DEBIT",
      reportGroup: received ? "CURRENT_LIABILITIES" : "CURRENT_ASSETS",
      controlType: received ? "INTEREST_PAYABLE" : "INTEREST_RECEIVABLE",
    }),
    result = await account({
      type: received ? "OTHER_EXPENSE" : "OTHER_INCOME",
      normalSide: received ? "DEBIT" : "CREDIT",
      reportGroup: received ? "OTHER_EXPENSES" : "OTHER_INCOME",
    }),
    v = await proof(),
    body = {
      name: prefix + " loan " + ++count,
      partyId,
      direction,
      startDate: p.start,
      maturityDate: p.end,
      agreedPrincipal: "1000.00",
      annualRate: null,
      agreement: "Reviewed synthetic loan agreement",
      principalAccountId: principal,
      interestAccountId: interest,
      interestResultAccountId: result,
      manualSchedule: [],
      reason: "Explicit synthetic loan mappings",
    },
    d = await loanCommand(
      v.actor,
      v.proof,
      "CREATE",
      body,
      crypto.randomUUID(),
    );
  return { ...d, body };
}
async function holding() {
  const partyId = await party(),
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
      reportGroup: "OTHER_EXPENSES",
    }),
    v = await proof(),
    body = {
      name: prefix + " holding " + ++count,
      partyId,
      investmentType: "Synthetic reviewed fund",
      unitMode: "UNIT",
      classification: "CURRENT",
      policyStatus: "REVIEWED",
      measurementMode: "MANUAL_VALUATION",
      valuationTreatment: "PROFIT_LOSS",
      policy:
        "Explicit synthetic measurement policy; no real company policy adopted",
      evidence: "Reviewed synthetic holding",
      investmentAccountId: control,
      gainAccountId: income,
      lossAccountId: expense,
      feeAccountId: expense,
      incomeAccountId: income,
      incomeControlAccountId: incomeControl,
      valuationOffsetAccountId: income,
      impairmentAccountId: expense,
      reason: "Explicit reviewed holding",
    },
    d = await holdingCommand(
      v.actor,
      v.proof,
      "CREATE",
      body,
      crypto.randomUUID(),
    );
  return { ...d, body };
}
async function project() {
  return db.project.create({
    data: {
      name: prefix + " project " + ++count,
      description: "Synthetic source dimension",
      managerId: people.owner.id,
    },
  });
}
async function invoice(
  p: { start: string; end: string },
  projectId: string | null = null,
) {
  const client = await party("CLIENT"),
    ar = await account({ controlType: "RECEIVABLES" }),
    revenue = await account({
      type: "INCOME",
      normalSide: "CREDIT",
      reportGroup: "REVENUE",
    }),
    deferred = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "DEFERRED_REVENUE",
    }),
    d = await inv("CREATE", {
      reference: prefix + " invoice " + ++count,
      partyId: client,
      receivableAccountId: ar,
      projectId,
      invoiceDate: p.start,
      postingDate: p.start,
      dueDate: p.end,
      description: "Actual earned and deferred billing",
      evidence: "Reviewed synthetic invoice",
      lines: [
        {
          description: "Actual earned service",
          quantity: "1",
          unitRate: "100.01",
          recognition: "EARNED",
          revenueAccountId: revenue,
          projectId,
        },
        {
          description: "Actual unearned billing",
          quantity: "1",
          unitRate: "40.00",
          recognition: "DEFERRED",
          revenueAccountId: revenue,
          deferredAccountId: deferred,
          projectId,
        },
      ],
      reason: "Recognize actual earned/deferred source",
    });
  await inv("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual billing",
  });
  return { d, client, ar, revenue, deferred };
}
async function credit(
  p: { start: string; end: string },
  f: Awaited<ReturnType<typeof invoice>>,
  offset = 2,
) {
  const advance = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "CLIENT_ADVANCE",
    }),
    line = await db.financeInvoiceLine.findFirstOrThrow({
      where: { invoiceId: f.d.id, recognition: "EARNED" },
    }),
    d = await customer("CUSTOMER_CREDIT", "CREATE", {
      reference: prefix + " credit " + ++count,
      partyId: f.client,
      invoiceId: f.d.id,
      advanceAccountId: advance,
      documentDate: plus(p.start, offset),
      postingDate: plus(p.start, offset),
      description: "Actual dated source-line credit",
      evidence: "Reviewed actual credit",
      creditLines: [{ invoiceLineId: line.id, amount: "30.00" }],
      reason: "Actual reviewed credit",
    });
  await customer("CUSTOMER_CREDIT", "POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual credit",
  });
  return d;
}
async function assetFixture() {
  const dates = (
    await db.$queryRaw<
      { start: string; end: string; month: string; monthEnd: string }[]
    >`SELECT d::date::text AS start,(d+interval '2 months'-interval '1 day')::date::text AS end,to_char(d,'YYYY-MM') AS month,(d+interval '1 month'-interval '1 day')::date::text AS "monthEnd" FROM generate_series(DATE '1800-01-01',DATE '1849-01-01',interval '2 months')d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]') && daterange(d::date,(d+interval '2 months'-interval '1 day')::date,'[]')) ORDER BY d LIMIT 1`
  )[0];
  if (!dates) throw Error("No isolated asset report period");
  const p = {
      ...dates,
      id: (
        await config("PERIOD_CREATE", {
          name: prefix + " asset report dates",
          startDate: dates.start,
          endDate: dates.end,
          reason: "Isolated synthetic two-month source interval",
        })
      ).id,
    },
    fixed = await account({
      reportGroup: "NONCURRENT_ASSETS",
      controlType: "FIXED_ASSET",
    }),
    funded = await post(p, {
      kind: "FOUNDER_OUTLAY",
      partyId: await party(),
      controlAccountId: await account({
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "FOUNDER_PAYABLE",
      }),
      counterAccountId: fixed,
      amount: "120.01",
    }),
    v = await proof(),
    a = await assetCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        tag: prefix + ".ASSET." + ++count,
        description: "Synthetic registered equipment",
        location: "Synthetic office",
        custodianId: null,
        billLineId: null,
        fundingMovementId: funded.id,
        cost: "120.01",
        inServiceDate: p.start,
        usefulLifeMonths: 2,
        residualValue: "0.00",
        depreciationMethod: "STRAIGHT_LINE",
        convention: "FULL_MONTH_FROM_FIRST_MONTH",
        firstDepMonth: p.month,
        policyEvidence: "Reviewed actual monthly convention",
        reason: "Register actual posted property",
      },
      crypto.randomUUID(),
    );
  return { p, fixed, a };
}
const row = (
  r: Awaited<ReturnType<typeof rollforward>>,
  entity: string,
  metric: string,
) => r.items.find((v) => v.entityId === entity && v.metric === metric)!;
it("funding openings/changes/closings include actual cash and noncash capital without treating personal outlay as capital", async () => {
  const f = await funding();
  await post(f.p, {
    kind: "CAPITAL_CONTRIBUTION",
    partyId: f.contributor,
    controlAccountId: f.capital,
    toCashId: f.b.id,
    amount: "200.01",
  });
  await post(f.p, {
    kind: "NONCASH_CAPITAL",
    partyId: f.contributor,
    controlAccountId: f.capital,
    counterAccountId: await account(),
    amount: "20.00",
    approvalEvidence: "Reviewed noncash property value",
    documentDate: plus(f.p.start, 1),
    postingDate: plus(f.p.start, 1),
  });
  await post(f.p, {
    kind: "CAPITAL_RETURN",
    partyId: f.contributor,
    controlAccountId: f.capital,
    fromCashId: f.b.id,
    amount: "50.00",
    approvalEvidence: "Explicit company capital return",
    documentDate: plus(f.p.start, 2),
    postingDate: plus(f.p.start, 2),
  });
  const r = await report("FUNDING", f.p, {
    from: plus(f.p.start, 1),
    q: f.name,
  });
  expect(row(r, f.contributor, "CAPITAL")).toMatchObject({
    openingBalance: "200.01",
    increases: "20.00",
    decreases: "50.00",
    periodNet: "-30.00",
    closingBalance: "170.01",
  });
  expect(r.reconciliation.ready).toBe(true);
});
it("actual funding reversals inherit dated signs and distribution equity uses its actual debit side", async () => {
  const f = await funding(),
    distribution = await account({
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
      controlType: "DISTRIBUTION",
    }),
    d = await post(f.p, {
      kind: "DISTRIBUTION",
      partyId: f.contributor,
      controlAccountId: distribution,
      fromCashId: f.b.id,
      amount: "10.01",
      approvalEvidence: "Reviewed actual distribution, no inferred percentage",
    });
  await move("REVERSE", {
    id: d.id,
    expectedVersion: 2,
    postingDate: plus(f.p.start, 2),
    reason: "Actual later distribution opposite",
  });
  expect(
    row(
      await report("FUNDING", f.p, { to: f.p.start, q: f.name }),
      f.contributor,
      "DISTRIBUTION",
    ).closingBalance,
  ).toBe("10.01");
  expect(
    row(
      await report("FUNDING", f.p, { q: f.name }),
      f.contributor,
      "DISTRIBUTION",
    ),
  ).toMatchObject({
    increases: "10.01",
    decreases: "10.01",
    closingBalance: "0.00",
  });
});
for (const direction of ["RECEIVED", "ADVANCED"])
  it(
    direction +
      " loan principal and interest remain separate with actual settlement dates",
    async () => {
      const p = await newPeriod(),
        l = await loan(p, direction),
        b = await bank(),
        received = direction === "RECEIVED";
      await post(p, {
        kind: "LOAN_DISBURSEMENT",
        loanId: l.id,
        amount: "100.01",
        ...(received ? { toCashId: b.id } : { fromCashId: b.id }),
      });
      await post(p, {
        kind: "LOAN_INTEREST_ACCRUAL",
        loanId: l.id,
        amount: "12.50",
      });
      await post(p, {
        kind: "LOAN_REPAYMENT",
        loanId: l.id,
        amount: "20.00",
        ...(received ? { fromCashId: b.id } : { toCashId: b.id }),
        documentDate: plus(p.start, 2),
        postingDate: plus(p.start, 2),
      });
      await post(p, {
        kind: "LOAN_INTEREST_SETTLEMENT",
        loanId: l.id,
        amount: "2.00",
        ...(received ? { fromCashId: b.id } : { toCashId: b.id }),
        documentDate: plus(p.start, 2),
        postingDate: plus(p.start, 2),
      });
      const before = await report("LOANS", p, { to: p.start, q: l.body.name }),
        after = await report("LOANS", p, { q: l.body.name });
      expect(row(before, l.id, direction + "_PRINCIPAL").closingBalance).toBe(
        "100.01",
      );
      expect(row(after, l.id, direction + "_PRINCIPAL").closingBalance).toBe(
        "80.01",
      );
      expect(row(after, l.id, direction + "_INTEREST").closingBalance).toBe(
        "10.50",
      );
      expect(after.reconciliation.ready).toBe(true);
    },
  );
it("investment original cost, carrying valuation and six-place units stay separate and historical", async () => {
  const p = await newPeriod(),
    h = await holding(),
    b = await bank();
  await post(p, {
    kind: "INVESTMENT_ACQUISITION",
    holdingId: h.id,
    fromCashId: b.id,
    units: "3.000001",
    amount: "100.01",
  });
  await post(p, {
    kind: "INVESTMENT_VALUATION_UP",
    approvalEvidence: "Explicit reviewed synthetic valuation",
    holdingId: h.id,
    amount: "9.99",
    allocations: [
      {
        lotId: (
          await db.financeInvestmentLot.findFirstOrThrow({
            where: { holdingId: h.id },
          })
        ).id,
        carryingAmount: "9.99",
      },
    ],
    documentDate: plus(p.start, 2),
    postingDate: plus(p.start, 2),
  });
  const before = await report("INVESTMENTS", p, {
      to: p.start,
      q: h.body.name,
    }),
    r = await report("INVESTMENTS", p, { q: h.body.name });
  expect(row(before, h.id, "CARRYING").closingBalance).toBe("100.01");
  expect(row(r, h.id, "COST").closingBalance).toBe("100.01");
  expect(row(r, h.id, "CARRYING").closingBalance).toBe("110.00");
  expect(row(r, h.id, "UNITS").closingBalance).toBe("3.000001");
  expect(r.totals.every((v) => v.metric !== "UNITS")).toBe(true);
  expect(r.reconciliation.ready).toBe(true);
});
it("investment income accrual and later collection reconstruct actual receivable without adding to carrying value", async () => {
  const p = await newPeriod(),
    h = await holding(),
    b = await bank();
  await post(p, {
    kind: "INVESTMENT_INCOME_ACCRUAL",
    holdingId: h.id,
    amount: "12.50",
  });
  await post(p, {
    kind: "INVESTMENT_INCOME_SETTLEMENT",
    holdingId: h.id,
    toCashId: b.id,
    amount: "2.00",
    documentDate: plus(p.start, 2),
    postingDate: plus(p.start, 2),
  });
  const r = await report("INVESTMENTS", p, {
    from: plus(p.start, 1),
    q: h.body.name,
  });
  expect(row(r, h.id, "INCOME_RECEIVABLE")).toMatchObject({
    openingBalance: "12.50",
    decreases: "2.00",
    closingBalance: "10.50",
  });
  expect(r.items.every((v) => v.metric !== "CARRYING")).toBe(true);
});
it("registered asset purchase is a source allocation without duplicate GL, actual depreciation changes carrying only at its date", async () => {
  const f = await assetFixture(),
    expense = await account({
      type: "OPERATING_EXPENSE",
      reportGroup: "OPERATING_EXPENSES",
    }),
    acc = await account({
      reportGroup: "NONCURRENT_ASSETS",
      normalSide: "CREDIT",
      isContra: true,
      controlType: "ACCUMULATED_DEPRECIATION",
    }),
    n = await db.financeJournalEntry.count(),
    d = await assetMove("GENERATE", {
      assetId: f.a.id,
      month: f.p.month,
      postingDate: f.p.monthEnd,
      expenseAccountId: expense,
      accumulatedAccountId: acc,
      evidence: "Reviewed monthly calculation",
      approvalEvidence: "Confirm actual monthly charge",
      reason: "Prepare actual monthly draft",
    });
  expect(await db.financeJournalEntry.count()).toBe(n);
  await assetMove("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual monthly depreciation",
  });
  const before = await report("ASSETS", f.p, {
      to: plus(f.p.monthEnd, -1),
      q: prefix,
    }),
    r = await report("ASSETS", f.p, { to: f.p.monthEnd, q: prefix });
  expect(row(before, f.a.id, "CARRYING").closingBalance).toBe("120.01");
  expect(row(r, f.a.id, "COST").closingBalance).toBe("120.01");
  expect(row(r, f.a.id, "DEPRECIATION").closingBalance).toBe("60.00");
  expect(row(r, f.a.id, "CARRYING").closingBalance).toBe("60.01");
  expect(
    r.reconciliation.issues.some(
      (i) => i.accountId === f.fixed || i.accountId === acc,
    ),
  ).toBe(false);
});
it("unregistered posted asset cost remains an explicit control issue under an empty display filter", async () => {
  const p = await newPeriod(),
    fixed = await account({
      controlType: "FIXED_ASSET",
      reportGroup: "NONCURRENT_ASSETS",
    });
  await post(p, {
    kind: "FOUNDER_OUTLAY",
    partyId: await party(),
    controlAccountId: await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "FOUNDER_PAYABLE",
    }),
    counterAccountId: fixed,
    amount: "19.01",
  });
  const r = await report("ASSETS", p, { q: crypto.randomUUID() });
  expect(r.items).toEqual([]);
  expect(r.reconciliation.ready).toBe(false);
  const sql = await db.$queryRaw<
    { d: { closingControl: string; closingDifference: string } }[]
  >`SELECT jsonb_build_object('closingControl',round(c."closingControl",2)::text,'closingDifference',round(c."closingDifference",2)::text) AS d FROM public.encova_finance_rollforward_controls('ASSETS',${p.start}::date,${p.end}::date)c WHERE c."accountId"=${fixed}::uuid`;
  expect(sql[0].d).toMatchObject({
    closingControl: "19.01",
    closingDifference: "-19.01",
  });
});
it("project results keep earned/deferred billing, unpaid costs and company unassigned costs separate", async () => {
  const p = await newPeriod(),
    proj = await project();
  await invoice(p, proj.id);
  const supplier = await party("SUPPLIER"),
    ap = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "PAYABLES",
    }),
    cost = await account({ type: "DIRECT_COST", reportGroup: "DIRECT_COSTS" });
  for (const projectId of [proj.id, null]) {
    const d = await bill("CREATE", {
      kind: "BILL",
      reference: prefix + " actual cost " + ++count,
      duplicateAcknowledged: projectId === null,
      partyId: supplier,
      payableAccountId: ap,
      projectId,
      billDate: p.start,
      postingDate: p.start,
      dueDate: p.end,
      description: "Actual incurred cost",
      evidence: "Reviewed synthetic actual cost",
      lines: [
        {
          description: "Actual direct work",
          quantity: "1",
          unitRate: "60.00",
          treatment: "EXPENSE",
          costAccountId: cost,
          projectId,
        },
      ],
      reason: "Recognize actual incurred cost",
    });
    await bill("POST", {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post actual unpaid cost",
    });
  }
  const r = await report("PROJECTS", p, { q: proj.name });
  expect(row(r, proj.id, "INCOME").closingBalance).toBe("100.01");
  expect(row(r, proj.id, "NET_BILLED").closingBalance).toBe("140.01");
  expect(row(r, proj.id, "DEFERRED_BILLING").closingBalance).toBe("40.00");
  expect(row(r, proj.id, "NET_RESULT").closingBalance).toBe("40.01");
  expect(r.totals.find((v) => v.metric === "NET_RESULT")?.periodNet).toBe(
    "-19.99",
  );
  expect(r.reconciliation.ready).toBe(true);
});
it("advance pool balances come from actual dated events; settlement release retains cash and its actual origin", async () => {
  const p = await newPeriod(),
    f = await invoice(p),
    b = await bank(),
    advance = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "CLIENT_ADVANCE",
    }),
    d = await customer("RECEIPT", "CREATE", {
      reference: prefix + " advance " + ++count,
      partyId: f.client,
      cashAccountId: b.id,
      advanceAccountId: advance,
      documentDate: p.start,
      postingDate: p.start,
      description: "Actual client held money",
      evidence: "Reviewed actual receipt",
      cashAmount: "100.00",
      allocations: [],
      reason: "Actual retained advance",
    });
  await customer("RECEIPT", "POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual advance",
  });
  const applied = await customer("ADVANCE_APPLICATION", "CREATE", {
    reference: prefix + " application " + ++count,
    partyId: f.client,
    sourceDocumentId: d.id,
    documentDate: plus(p.start, 2),
    postingDate: plus(p.start, 2),
    description: "Apply actual held money",
    evidence: "Reviewed actual application",
    allocations: [{ invoiceId: f.d.id, amount: "20.00" }],
    reason: "Actual dated advance use",
  });
  await customer("ADVANCE_APPLICATION", "POST", {
    id: applied.id,
    expectedVersion: applied.version,
    reason: "Post actual advance application",
  });
  const r = await report("ADVANCES", p, { from: plus(p.start, 1), q: d.id });
  expect(row(r, d.id, "CLIENT_ADVANCE")).toMatchObject({
    openingBalance: "100.00",
    decreases: "20.00",
    closingBalance: "80.00",
  });
  expect(r.reconciliation.ready).toBe(true);
});
it("company totals and event proof cannot shrink with display search; real date extremes remain safe", async () => {
  const f = await funding();
  await post(f.p, {
    kind: "CAPITAL_CONTRIBUTION",
    partyId: f.contributor,
    controlAccountId: f.capital,
    toCashId: f.b.id,
    amount: "10.01",
  });
  const a = await report("FUNDING", f.p),
    b = await report("FUNDING", f.p, { q: crypto.randomUUID() });
  expect(b.items).toEqual([]);
  expect(b.totals).toEqual(a.totals);
  expect(b.reconciliation).toEqual(a.reconciliation);
  expect(b.metadata.filters.eventDigest).toBe(a.metadata.filters.eventDigest);
  expect(
    (
      await rollforward(people.owner, "FUNDING", {
        from: "0001-01-01",
        to: "9999-12-31",
        page: 10000,
      })
    ).reconciliation.ready,
  ).toBe(true);
});
it("source history retains original opening and earlier-page carry across27 actual funding events", async () => {
  const f = await funding();
  for (let n = 0; n < 27; n++)
    await post(f.p, {
      kind: "CAPITAL_CONTRIBUTION",
      partyId: f.contributor,
      controlAccountId: f.capital,
      toCashId: f.b.id,
      amount: "1.01",
    });
  const r = await report("FUNDING", f.p, { q: f.name }),
    key = row(r, f.contributor, "CAPITAL").rowKey,
    a = await rollforwardHistory(people.owner, "FUNDING", {
      from: f.p.start,
      to: f.p.end,
      rowKey: key,
    }),
    b = await rollforwardHistory(people.owner, "FUNDING", {
      from: f.p.start,
      to: f.p.end,
      rowKey: key,
      page: 2,
    });
  expect(a).toMatchObject({
    total: 27,
    page: 1,
    pages: 2,
    closingBalance: "27.27",
  });
  expect(a.items.at(-1)?.runningBalance).toBe("25.25");
  expect(b.items.map((e) => e.runningBalance)).toEqual(["26.26", "27.27"]);
}, 30000);
it("posted credit and typed opposite source viewers resolve the correct original workflow and actual immutable entry", async () => {
  const p = await newPeriod(),
    f = await invoice(p),
    c = await credit(p, f);
  await customer("CUSTOMER_CREDIT", "REVERSE", {
    id: c.id,
    expectedVersion: 2,
    postingDate: plus(p.start, 3),
    reason: "Actual dated credit opposite",
  });
  const original = await db.financeJournalEntry.findUniqueOrThrow({
      where: { customerDocumentId: c.id },
    }),
    doc = await db.financeCustomerDocument.findFirstOrThrow({
      where: { reversalOfId: c.id },
    }),
    e = await db.financeJournalEntry.findUniqueOrThrow({
      where: { customerDocumentId: doc.id },
    }),
    a = await postedSource(people.owner, { id: original.id }),
    b = await postedSource(people.owner, { id: e.id });
  expect(a.workflow).toMatchObject({
    href: "/finance/customer-credits/" + c.id,
    original: false,
  });
  expect(b.workflow).toMatchObject({
    href: "/finance/customer-credits/" + c.id,
    original: true,
  });
  expect(b.entry.originalJournalId).toBe(original.id);
  expect(b.entry.id).toBe(e.id);
  expect(b.difference).toBe("0.00");
  expect(JSON.stringify(b)).not.toContain(password);
});
it("posted source lines page after exact complete entry totals and read operations create no GL/audit", async () => {
  const p = await newPeriod(),
    debit = await account(),
    credit = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    d = await journal("CREATE", {
      reference: prefix + " 27 actual lines",
      postingDate: p.start,
      description: "Actual bounded source line pagination",
      evidence: "Reviewed ordinary posting",
      lines: [
        ...Array.from({ length: 26 }, () => ({
          accountId: debit,
          description: "Actual source debit",
          debit: "1.00",
          credit: "0.00",
        })),
        {
          accountId: credit,
          description: "Actual balancing credit",
          debit: "0.00",
          credit: "26.00",
        },
      ],
      reason: "Actual ordinary source",
    });
  await journal("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual source lines",
  });
  const e = await db.financeJournalEntry.findUniqueOrThrow({
      where: { draftId: d.id },
    }),
    n = await db.financeJournalEntry.count(),
    audit = await db.financeAuditEvent.count(),
    a = await postedSource(people.owner, { id: e.id }),
    b = await postedSource(people.owner, { id: e.id, page: 2 });
  expect(a).toMatchObject({
    total: 27,
    page: 1,
    pages: 2,
    debitTotal: "26.00",
    creditTotal: "26.00",
    difference: "0.00",
  });
  expect(a.items).toHaveLength(25);
  expect(b.items).toHaveLength(2);
  expect(b.debitTotal).toBe("26.00");
  expect(await db.financeJournalEntry.count()).toBe(n);
  expect(await db.financeAuditEvent.count()).toBe(audit);
});
it("current selected administrators read reports and sources while ordinary/unselected/revoked/disabled callers are denied", async () => {
  const f = await funding(),
    d = await post(f.p, {
      kind: "CAPITAL_CONTRIBUTION",
      partyId: f.contributor,
      controlAccountId: f.capital,
      toCashId: f.b.id,
      amount: "10.01",
    }),
    e = await db.financeJournalEntry.findUniqueOrThrow({
      where: { movementId: d.id },
    });
  expect((await postedSource(people.selected, { id: e.id })).entry.id).toBe(
    e.id,
  );
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(postedSource(people[who], { id: e.id })).rejects.toMatchObject(
      { status: 403 },
    );
    for (const kind of [
      "PROJECTS",
      "FUNDING",
      "LOANS",
      "INVESTMENTS",
      "ASSETS",
      "ADVANCES",
    ])
      await expect(
        rollforward(people[who], kind, { from: f.p.start, to: f.p.end }),
      ).rejects.toMatchObject({ status: 403 });
  }
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  await expect(
    postedSource(people.selected, { id: e.id }),
  ).rejects.toMatchObject({ status: 403 });
  env.FINANCE_ENABLED = false;
  await expect(report("FUNDING", f.p)).rejects.toMatchObject({ status: 404 });
  env.FINANCE_ENABLED = true;
});
it("raw roll-forward/source helpers remain denied to application and Data API roles", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"])
      for (const fn of [
        "encova_finance_rollforward_events(text,date)",
        "encova_finance_rollforward_controls(text,date,date)",
        "encova_finance_rollforward_report(text,date,date,text,integer,integer)",
        "encova_finance_rollforward_history(text,date,date,text,integer)",
      ])
        expect(
          (
            await sql.query(
              "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
              [role, fn],
            )
          ).rows[0].allowed,
        ).toBe(false);
    expect(
      (
        await sql.query(
          "SELECT has_function_privilege('encova_app','encova_finance_posted_source_read(uuid,jsonb)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
  } finally {
    await sql.end();
  }
});
it("a tiny negative-unit recovery fault remains explicit at six places instead of rounding into a zero diagnostic", async () => {
  const p = await newPeriod(),
    h = await holding(),
    b = await bank(),
    d = await post(p, {
      kind: "INVESTMENT_ACQUISITION",
      holdingId: h.id,
      fromCashId: b.id,
      units: "3.000001",
      amount: "100.01",
    }),
    event = await db.financeInvestmentEvent.findFirstOrThrow({
      where: { movementId: d.id },
    }),
    sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("BEGIN");
    await sql.query('ALTER TABLE "FinanceInvestmentEvent" DISABLE TRIGGER ALL');
    await sql.query(
      'UPDATE "FinanceInvestmentEvent" SET "unitsDelta"=-0.000001 WHERE id=$1',
      [event.id],
    );
    const r = (
      await sql.query(
        "SELECT encova_finance_rollforward_report('INVESTMENTS',$1,$2,$3,1,1) AS d",
        [p.start, p.end, h.body.name],
      )
    ).rows[0].d;
    expect(r.reconciliation.ready).toBe(false);
    expect(
      r.reconciliation.issues.find(
        (i: { metric: string }) => i.metric === "UNITS",
      ).closingDifference,
    ).toBe("-0.000001");
  } finally {
    await sql.query("ROLLBACK");
    await sql.end();
  }
});
