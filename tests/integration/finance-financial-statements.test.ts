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
  prefix = "FS34." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0;
let previousPolicy: { overdraftPresentation: string; evidence: string } | null =
  null;
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
  previousPolicy = await db.financeStatementPolicy.findFirst({
    select: { overdraftPresentation: true, evidence: true },
  });
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
  const current = await db.financeStatementPolicy.findFirst();
  if (current)
    await setting("POLICY_SET", {
      overdraftPresentation:
        previousPolicy?.overdraftPresentation ?? "UNREVIEWED",
      evidence:
        previousPolicy?.evidence ??
        "Restore unreviewed synthetic presentation; no company policy adopted",
      expectedVersion: current.version,
      reason: "Restore prior synthetic statement presentation",
    });
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

const {
  profitLoss,
  balanceSheet,
  statementSettings,
  statementMappingOptions,
  statementTaxMapping,
  statementSettingCommand,
} = await import("@/modules/finance/reports/statements/service");
const { invoiceCommand } =
  await import("@/modules/finance/receivables/service");
const { billCommand } = await import("@/modules/finance/payables/service");
const { ledgerCommand } = await import("@/modules/finance/ledger/service");
const { movementCommand } = await import("@/modules/finance/treasury/service");
const plus = (day: string, n: number) =>
  new Date(new Date(day + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
const minor = (x: string) => BigInt(x.replace(".", ""));
async function setting(
  action: Parameters<typeof statementSettingCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return statementSettingCommand(v.actor, v.proof, action, input, key);
}
async function policy(overdraftPresentation = "CURRENT_LIABILITY") {
  const p = await db.financeStatementPolicy.findFirst();
  return setting("POLICY_SET", {
    overdraftPresentation,
    expectedVersion: p?.version ?? null,
    evidence:
      "Explicit synthetic presentation policy; no real company policy adopted",
    reason: "Review report presentation without changing ledger",
  });
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
async function journal(
  action: Parameters<typeof ledgerCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return ledgerCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function movement(
  action: Parameters<typeof movementCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return movementCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function party(kind = "CLIENT") {
  return (
    await master("PARTY_CREATE", {
      name: prefix + " party " + ++count,
      legalName: "Synthetic Legal Co",
      kind,
      contactEmail: "synthetic@example.test",
      phone: null,
      address: null,
      userId: null,
      reason: "Explicit synthetic statement party",
    })
  ).id;
}
async function bank() {
  const gl = await account({ controlType: "CASH" }),
    b = await master("CASH_CREATE", {
      name: prefix + " bank " + ++count,
      kind: "BANK",
      glAccountId: gl,
      maskedReference: "1234",
      reason: "Explicit synthetic statement bank",
    });
  return { id: b.id, gl };
}
async function fixture() {
  const p = await newPeriod(),
    client = await party(),
    supplier = await party("SUPPLIER"),
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
    ap = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "PAYABLES",
    }),
    direct = await account({
      type: "DIRECT_COST",
      reportGroup: "DIRECT_COSTS",
    });
  async function invoice(earned = "100.01", defer = "40.00", quantity = "1") {
    const lines = [
      {
        description: "Actual earned service",
        quantity,
        unitRate: earned,
        recognition: "EARNED",
        revenueAccountId: revenue,
      },
      ...(defer === "0.00"
        ? []
        : [
            {
              description: "Actual unearned advance billing",
              quantity: "1",
              unitRate: defer,
              recognition: "DEFERRED",
              revenueAccountId: revenue,
              deferredAccountId: deferred,
            },
          ]),
    ];
    const i = await inv("CREATE", {
      partyId: client,
      receivableAccountId: ar,
      invoiceDate: p.start,
      postingDate: p.start,
      dueDate: p.end,
      description: "Actual earned versus deferred billing",
      evidence: "Reviewed synthetic unpaid invoice",
      lines,
      reason: "Recognize actual invoiced source",
    });
    await inv("POST", {
      id: i.id,
      expectedVersion: i.version,
      reason: "Explicit actual invoice posting",
    });
    return i;
  }
  async function cost(amount = "60.00", extra: Record<string, unknown>[] = []) {
    const b = await bill("CREATE", {
      kind: "BILL",
      reference: prefix + " bill " + ++count,
      partyId: supplier,
      payableAccountId: ap,
      billDate: p.start,
      postingDate: p.start,
      dueDate: p.end,
      description: "Actual incurred unpaid cost",
      evidence: "Reviewed synthetic supplier source",
      lines: [
        {
          description: "Actual direct cost",
          quantity: "1",
          unitRate: amount,
          treatment: "EXPENSE",
          costAccountId: direct,
        },
        ...extra,
      ],
      reason: "Recognize incurred cost rather than cash",
    });
    await bill("POST", {
      id: b.id,
      expectedVersion: b.version,
      reason: "Explicit actual supplier cost posting",
    });
    return b;
  }
  return {
    p,
    client,
    supplier,
    ar,
    revenue,
    deferred,
    ap,
    direct,
    invoice,
    cost,
  };
}
const reportRange = (p: { start: string; end: string }) => ({
  from: p.start,
  to: p.end,
});
async function accrue(
  p: { start: string },
  debit: string,
  credit: string,
  amount: string,
) {
  const j = await journal("CREATE", {
    reference: prefix + " accrual " + ++count,
    postingDate: p.start,
    description: "Actual reviewed ordinary accrual",
    evidence: "Synthetic actual accounting source",
    lines: [
      {
        accountId: debit,
        description: "Actual debit recognition",
        debit: amount,
        credit: "0.00",
      },
      {
        accountId: credit,
        description: "Actual credit recognition",
        debit: "0.00",
        credit: amount,
      },
    ],
    reason: "Explicit reviewed ordinary accounting",
  });
  await journal("POST", {
    id: j.id,
    expectedVersion: j.version,
    reason: "Explicit actual accrual posting",
  });
  return j;
}
it("posted earned billing and unpaid direct costs determine profit; deferred billing is liability and unclosed profit appears once", async () => {
  await policy();
  const f = await fixture(),
    before = await balanceSheet(people.owner, { asOf: plus(f.p.start, -1) });
  await f.invoice();
  await f.cost();
  const pl = await profitLoss(people.owner, reportRange(f.p)),
    bs = await balanceSheet(people.owner, { asOf: f.p.end });
  expect(pl.sections).toMatchObject({
    revenue: "100.01",
    directCosts: "60.00",
    grossProfit: "40.01",
    netProfit: "40.01",
  });
  expect(
    minor(bs.sections.totalAssets) - minor(before.sections.totalAssets),
  ).toBe(14001n);
  expect(
    minor(bs.sections.totalLiabilities) -
      minor(before.sections.totalLiabilities),
  ).toBe(10000n);
  expect(
    minor(bs.sections.unclosedProfit) - minor(before.sections.unclosedProfit),
  ).toBe(4001n);
  expect(bs.sections.difference).toBe("0.00");
  expect(bs.readiness.finalExportEligible).toBe(true);
  expect(pl.items.find((a) => a.id === f.revenue)?.statementAmount).toBe(
    "100.01",
  );
});
it("asset and prepayment purchase lines stay outside incurred P&L and remain on the balance sheet", async () => {
  await policy();
  const f = await fixture(),
    prepay = await account({ reportGroup: "CURRENT_ASSETS" }),
    fixed = await account({
      reportGroup: "NONCURRENT_ASSETS",
      controlType: "FIXED_ASSET",
    }),
    before = await balanceSheet(people.owner, { asOf: plus(f.p.start, -1) });
  await f.cost("60.00", [
    {
      description: "Actual prepaid service",
      quantity: "1",
      unitRate: "20.00",
      treatment: "PREPAYMENT",
      costAccountId: prepay,
    },
    {
      description: "Actual purchased asset",
      quantity: "1",
      unitRate: "100.00",
      treatment: "ASSET",
      costAccountId: fixed,
    },
  ]);
  const pl = await profitLoss(people.owner, reportRange(f.p)),
    bs = await balanceSheet(people.owner, { asOf: f.p.end });
  expect(pl.sections.netProfit).toBe("-60.00");
  expect(
    minor(bs.sections.totalAssets) - minor(before.sections.totalAssets),
  ).toBe(12000n);
  expect(
    minor(bs.sections.totalLiabilities) -
      minor(before.sections.totalLiabilities),
  ).toBe(18000n);
  expect(bs.sections.difference).toBe("0.00");
});
it("operating/other results and explicit tax expense presentation preserve net profit without duplicating cost or GL", async () => {
  await policy();
  const f = await fixture();
  await f.invoice("100.01", "0.00");
  await f.cost();
  const operating = await account({
      type: "OPERATING_EXPENSE",
      reportGroup: "OPERATING_EXPENSES",
    }),
    otherExpense = await account({
      type: "OTHER_EXPENSE",
      reportGroup: "OTHER_EXPENSES",
    }),
    tax = await account({
      type: "OTHER_EXPENSE",
      reportGroup: "OTHER_EXPENSES",
    }),
    otherIncome = await account({
      type: "OTHER_INCOME",
      normalSide: "CREDIT",
      reportGroup: "OTHER_INCOME",
    }),
    liability = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    asset = await account();
  await accrue(f.p, operating, liability, "10.00");
  await accrue(f.p, otherExpense, liability, "3.00");
  await accrue(f.p, tax, liability, "7.00");
  await accrue(f.p, asset, otherIncome, "5.00");
  const before = await profitLoss(people.owner, reportRange(f.p)),
    n = await db.financeJournalEntry.count();
  await setting("TAX_MAPPING_SET", {
    accountId: tax,
    active: true,
    expectedVersion: null,
    evidence: "Explicit synthetic income-tax expense classification",
    reason: "Present actual recorded expense without additional recognition",
  });
  const after = await profitLoss(people.owner, reportRange(f.p));
  expect(before.sections.netProfit).toBe("25.01");
  expect(after.sections).toMatchObject({
    operatingProfit: "30.01",
    otherIncome: "5.00",
    otherExpenses: "3.00",
    profitBeforeIncomeTax: "32.01",
    incomeTaxExpense: "7.00",
    netProfit: "25.01",
  });
  expect(after.metadata.filters.taxMappingDigest).not.toBe(
    before.metadata.filters.taxMappingDigest,
  );
  expect(after.metadata.ledgerDigest).toBe(before.metadata.ledgerDigest);
  expect(await db.financeJournalEntry.count()).toBe(n);
});
it("deferred-only invoicing never becomes earned profit or cash before actual recognition", async () => {
  await policy();
  const f = await fixture(),
    d = await inv("CREATE", {
      partyId: f.client,
      receivableAccountId: f.ar,
      invoiceDate: f.p.start,
      postingDate: f.p.start,
      dueDate: f.p.end,
      description: "Actual fully deferred billing",
      evidence: "Synthetic unearned source",
      lines: [
        {
          description: "Deferred service",
          quantity: "1",
          unitRate: "40.00",
          recognition: "DEFERRED",
          revenueAccountId: f.revenue,
          deferredAccountId: f.deferred,
        },
      ],
      reason: "Review deferred source",
    });
  await inv("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual deferred source",
  });
  const pl = await profitLoss(people.owner, reportRange(f.p));
  expect(pl.sections.revenue).toBe("0.00");
  expect(pl.sections.netProfit).toBe("0.00");
  expect(
    (await balanceSheet(people.owner, { asOf: f.p.end })).sections.difference,
  ).toBe("0.00");
});
it("contra asset credits reduce assets while the actual expense reduces unclosed profit", async () => {
  await policy();
  const p = await newPeriod(),
    asset = await account({ reportGroup: "NONCURRENT_ASSETS" }),
    contra = await account({
      reportGroup: "NONCURRENT_ASSETS",
      isContra: true,
      normalSide: "CREDIT",
    }),
    equity = await account({
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
    }),
    expense = await account({
      type: "OPERATING_EXPENSE",
      reportGroup: "OPERATING_EXPENSES",
    }),
    before = await balanceSheet(people.owner, { asOf: plus(p.start, -1) });
  await accrue(p, asset, equity, "100.00");
  await accrue(p, expense, contra, "25.00");
  const bs = await balanceSheet(people.owner, { asOf: p.end });
  expect(
    minor(bs.sections.totalAssets) - minor(before.sections.totalAssets),
  ).toBe(7500n);
  expect(
    minor(bs.sections.postedEquity) - minor(before.sections.postedEquity),
  ).toBe(10000n);
  expect(
    minor(bs.sections.unclosedProfit) - minor(before.sections.unclosedProfit),
  ).toBe(-2500n);
  expect(bs.sections.difference).toBe("0.00");
});
it("unreviewed overdraft presentation blocks final eligibility; reviewed reclassification changes no ledger amounts", async () => {
  await policy("UNREVIEWED");
  const p = await newPeriod(),
    from = await bank(),
    to = await bank(),
    m = await movement("CREATE", {
      kind: "TRANSFER",
      reference: prefix + " overdraft " + ++count,
      fromCashId: from.id,
      toCashId: to.id,
      amount: "10.01",
      documentDate: p.start,
      postingDate: p.start,
      description: "Actual synthetic bank movement",
      evidence: "Explicit synthetic cash source",
      reason: "Review actual bank transfer",
    });
  await movement("POST", {
    id: m.id,
    expectedVersion: m.version,
    reason: "Post actual bank movement",
  });
  const before = await balanceSheet(people.owner, { asOf: p.end }),
    n = await db.financeJournalEntry.count();
  expect(before.readiness.finalExportEligible).toBe(false);
  expect(before.readiness.issueCount).toBeGreaterThan(0);
  expect(before.sections.difference).toBe("0.00");
  await policy();
  const after = await balanceSheet(people.owner, { asOf: p.end });
  expect(after.readiness.finalExportEligible).toBe(true);
  expect(after.sections.difference).toBe("0.00");
  expect(after.sections.unclosedProfit).toBe(before.sections.unclosedProfit);
  expect(await db.financeJournalEntry.count()).toBe(n);
});
it("display filters cannot shrink complete profit/position totals or hide overall mapping readiness", async () => {
  await policy();
  const f = await fixture();
  await f.invoice();
  await f.cost();
  const full = await profitLoss(people.owner, reportRange(f.p)),
    a = await db.financeAccount.findUniqueOrThrow({ where: { id: f.revenue } }),
    filtered = await profitLoss(people.owner, {
      ...reportRange(f.p),
      q: a.code,
    }),
    bs = await balanceSheet(people.owner, { asOf: f.p.end }),
    narrow = await balanceSheet(people.owner, { asOf: f.p.end, q: a.code });
  expect(filtered.total).toBe(1);
  expect(filtered.sections).toEqual(full.sections);
  expect(narrow.sections).toEqual(bs.sections);
  expect(narrow.readiness.issueCount).toBe(bs.readiness.issueCount);
});
it("actual large earned invoices preserve aggregate paisa beyond individual document limits", async () => {
  await policy();
  const f = await fixture();
  await f.invoice("99999999999999.999999", "0.00", "10000");
  await f.invoice("99999999999999.999999", "0.00", "10000");
  const pl = await profitLoss(people.owner, reportRange(f.p));
  expect(pl.sections.revenue).toBe("1999999999999999999.98");
  expect(pl.sections.netProfit).toBe("1999999999999999999.98");
  expect(
    (await balanceSheet(people.owner, { asOf: f.p.end })).sections.difference,
  ).toBe("0.00");
});
it("presentation changes require current owner, key/version/idempotency and retain audited revisions", async () => {
  await policy();
  const current = (await statementSettings(people.owner)).policy!,
    body = {
      overdraftPresentation: "CURRENT_LIABILITY",
      expectedVersion: current.version,
      evidence: "Reviewed synthetic report presentation",
      reason: "Explicit owner presentation decision",
    },
    key = crypto.randomUUID(),
    one = await setting("POLICY_SET", body, key);
  expect(await setting("POLICY_SET", body, key)).toEqual(one);
  await expect(
    setting("POLICY_SET", { ...body, evidence: "Different evidence" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  await expect(setting("POLICY_SET", body)).rejects.toMatchObject({
    code: "FINANCE_STALE_VERSION",
  });
  await expect(
    setting(
      "POLICY_SET",
      { ...body, expectedVersion: one.version },
      crypto.randomUUID(),
      "selected",
    ),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_REQUIRED" });
  expect(
    await db.financeAuditEvent.count({
      where: { entityId: one.id, action: "FINANCE_STATEMENT_POLICY_SET" },
    }),
  ).toBeGreaterThan(0);
});
it("tax mapping rejects protected VAT/withholding controls and income, supports archived expense history and audited deactivation", async () => {
  const protectedAccount = await account({
      controlType: "WITHHOLDING_RECEIVABLE",
    }),
    income = await account({
      type: "INCOME",
      normalSide: "CREDIT",
      reportGroup: "REVENUE",
    });
  for (const id of [protectedAccount, income])
    await expect(
      setting("TAX_MAPPING_SET", {
        accountId: id,
        active: true,
        expectedVersion: null,
        evidence: "Invalid classification cannot be applied",
        reason: "Test explicit financial mapping boundary",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_STATEMENT_TAX_MAPPING" });
  const expense = await account({
      type: "OTHER_EXPENSE",
      reportGroup: "OTHER_EXPENSES",
    }),
    a = await db.financeAccount.findUniqueOrThrow({ where: { id: expense } });
  await config("ACCOUNT_ARCHIVE", {
    id: a.id,
    expectedVersion: a.version,
    reason: "Retain historical expense account",
  });
  expect(
    (await statementMappingOptions(people.owner, { q: a.code })).items[0].name,
  ).toContain("(archived)");
  const mapped = await setting("TAX_MAPPING_SET", {
    accountId: a.id,
    active: true,
    expectedVersion: null,
    evidence: "Reviewed historical income-tax classification",
    reason: "Classify retained eligible expense",
  });
  expect((await statementTaxMapping(people.owner, a.id)).item?.active).toBe(
    true,
  );
  await setting("TAX_MAPPING_SET", {
    accountId: a.id,
    active: false,
    expectedVersion: mapped.version,
    evidence: "Restore ordinary expense presentation",
    reason: "Audited presentation correction",
  });
  expect((await statementTaxMapping(people.owner, a.id)).item?.version).toBe(2);
  await expect(
    db.financeStatementTaxMapping.delete({ where: { id: mapped.id } }),
  ).rejects.toThrow();
});
it("profit rows paginate stably while complete statement totals stay fixed", async () => {
  await policy();
  const p = await newPeriod(),
    credit = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    lines = [];
  for (let i = 0; i < 27; i++) {
    const id = await account({
      type: "OPERATING_EXPENSE",
      reportGroup: "OPERATING_EXPENSES",
    });
    lines.push(
      {
        accountId: id,
        description: "Actual small operating expense",
        debit: "0.01",
        credit: "0.00",
      },
      {
        accountId: credit,
        description: "Actual small liability",
        debit: "0.00",
        credit: "0.01",
      },
    );
  }
  const j = await journal("CREATE", {
    reference: prefix + " paged costs",
    postingDate: p.start,
    description: "Actual multi-account incurred costs",
    evidence: "Reviewed synthetic ordinary source",
    lines,
    reason: "Recognize actual small expenses",
  });
  await journal("POST", {
    id: j.id,
    expectedVersion: j.version,
    reason: "Explicit actual multi-line posting",
  });
  const one = await profitLoss(people.owner, reportRange(p)),
    two = await profitLoss(people.owner, { ...reportRange(p), page: 2 });
  expect(one).toMatchObject({ total: 27, page: 1, pages: 2 });
  expect(one.items).toHaveLength(25);
  expect(two.items).toHaveLength(2);
  expect(two.sections).toEqual(one.sections);
  expect(two.sections.netProfit).toBe("-0.27");
  expect(new Set([...one.items, ...two.items].map((a) => a.id)).size).toBe(27);
}, 25000);
it("unresolved presentation issues remain bounded and fully paginated", async () => {
  await policy("UNREVIEWED");
  const p = await newPeriod(),
    to = await bank();
  for (let i = 0; i < 27; i++) {
    const from = await bank(),
      m = await movement("CREATE", {
        kind: "TRANSFER",
        reference: prefix + " issue " + ++count,
        fromCashId: from.id,
        toCashId: to.id,
        amount: "0.01",
        documentDate: p.start,
        postingDate: p.start,
        description: "Actual individual negative bank",
        evidence: "Synthetic pending overdraft classification",
        reason: "Create actual presentation exception",
      });
    await movement("POST", {
      id: m.id,
      expectedVersion: m.version,
      reason: "Explicit actual bank posting",
    });
  }
  const one = await balanceSheet(people.owner, { asOf: p.end }),
    two = await balanceSheet(people.owner, { asOf: p.end, issuePage: 2 });
  expect(one.readiness.issueCount).toBeGreaterThanOrEqual(27);
  expect(one.readiness.issues).toHaveLength(25);
  expect(two.readiness.issues.length).toBeGreaterThanOrEqual(2);
  expect(
    new Set([...one.readiness.issues, ...two.readiness.issues].map((a) => a.id))
      .size,
  ).toBe(one.readiness.issues.length + two.readiness.issues.length);
  expect(one.readiness.finalExportEligible).toBe(false);
  await policy();
}, 30000);
it("readonly statements handle year1/9999 and add no GL/audit/receipt while maintaining independent exact equations", async () => {
  await policy();
  const before = [
      await db.financeJournalEntry.count(),
      await db.financeAuditEvent.count(),
      await db.financeLedgerReceipt.count(),
    ],
    bs = await balanceSheet(people.owner, { asOf: "0001-01-01" }),
    later = await balanceSheet(people.owner, { asOf: "9999-12-31" });
  expect(bs.sections.difference).toBe("0.00");
  expect(later.sections.difference).toBe("0.00");
  await profitLoss(people.owner, { from: "0001-01-01", to: "9999-12-31" });
  expect([
    await db.financeJournalEntry.count(),
    await db.financeAuditEvent.count(),
    await db.financeLedgerReceipt.count(),
  ]).toEqual(before);
});
it("runtime/Data API cannot write settings or invoke raw helpers and existing CSV import capabilities remain granted", async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"])
      expect(
        (
          await c.query(
            `SELECT has_table_privilege($1,'"FinanceStatementPolicy"','UPDATE') AS write,has_function_privilege($1,'encova_finance_statement_balances(date)','EXECUTE') AS helper`,
            [role],
          )
        ).rows[0],
      ).toEqual({ write: false, helper: false });
    expect(
      (
        await c.query(
          `SELECT has_function_privilege('encova_app','encova_finance_statement_command(uuid,text,text,timestamp with time zone,text,jsonb,text,uuid)','EXECUTE') AS prior`,
        )
      ).rows[0].prior,
    ).toBe(true);
  } finally {
    await c.end();
  }
});
it("current roles/grants/flag protect statements and presentation settings", async () => {
  for (const who of ["hr", "lead", "member", "other"])
    await expect(
      balanceSheet(people[who], { asOf: "9999-12-31" }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  await expect(statementSettings(people.selected)).rejects.toMatchObject({
    code: "FINANCE_FORBIDDEN",
  });
  env.FINANCE_ENABLED = false;
  try {
    await expect(
      profitLoss(people.owner, { from: "0001-01-01", to: "9999-12-31" }),
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
