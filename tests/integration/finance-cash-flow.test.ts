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
  prefix = "CF35." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

const { cashFlow, cashFlowReview, cashFlowConfirm } =
  await import("@/modules/finance/reports/cash-flow/service");
const { movementCommand } = await import("@/modules/finance/treasury/service");
const { customerCommand } =
  await import("@/modules/finance/receivables/customer/service");
const { supplierCommand } =
  await import("@/modules/finance/payables/supplier/service");
const { billCommand } = await import("@/modules/finance/payables/service");
async function movement(
  action: Parameters<typeof movementCommand>[2],
  body: unknown,
) {
  const v = await proof();
  return movementCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function customer(
  action: Parameters<typeof customerCommand>[3],
  body: unknown,
) {
  const v = await proof();
  return customerCommand(
    v.actor,
    v.proof,
    "RECEIPT",
    action,
    body,
    crypto.randomUUID(),
  );
}
async function supplier(
  action: Parameters<typeof supplierCommand>[3],
  body: unknown,
) {
  const v = await proof();
  return supplierCommand(
    v.actor,
    v.proof,
    "PAYMENT",
    action,
    body,
    crypto.randomUUID(),
  );
}
async function bill(action: Parameters<typeof billCommand>[2], body: unknown) {
  const v = await proof();
  return billCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function bank() {
  const gl = await account({ controlType: "CASH" });
  return {
    id: (
      await master("CASH_CREATE", {
        name: prefix + " bank " + ++count,
        kind: "BANK",
        glAccountId: gl,
        maskedReference: "1234",
        reason: "Reviewed synthetic cash source",
      })
    ).id,
    gl,
  };
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
      reason: "Reviewed synthetic party",
    })
  ).id;
}
async function receipt(
  p: Awaited<ReturnType<typeof newPeriod>>,
  cash = "98.00",
  fee = "2.00",
) {
  const b = await bank(),
    client = await party(),
    advance = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "CLIENT_ADVANCE",
    }),
    expense = await account({
      type: "OPERATING_EXPENSE",
      reportGroup: "OPERATING_EXPENSES",
    });
  const d = await customer("CREATE", {
    reference: prefix + " actual receipt " + ++count,
    partyId: client,
    cashAccountId: b.id,
    advanceAccountId: advance,
    feeAccountId: fee === "0.00" ? null : expense,
    documentDate: p.start,
    postingDate: p.start,
    description: "Actual cash net of separate bank fees",
    evidence: "Reviewed synthetic receipt",
    cashAmount: cash,
    feeAmount: fee,
    allocations: [],
    reason: "Actual receipt source",
  });
  await customer("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual receipt",
  });
  const e = await db.financeJournalEntry.findUniqueOrThrow({
    where: { customerDocumentId: d.id },
  });
  return { d, e, b };
}
const readReview = (journalId: string, who = "owner") =>
  cashFlowReview(people[who], { journalId });
const report = (p: { start: string; end: string }, extra = {}) =>
  cashFlow(people.owner, { from: p.start, to: p.end, ...extra });
async function body(journalId: string, category = "OPERATING") {
  const r = await readReview(journalId);
  return {
    journalId,
    basisHash: r.basisHash,
    expectedReviewId: r.review?.id ?? null,
    expectedVersion: r.review?.version ?? null,
    components: r.lines.map((l) => ({
      journalLineId: l.id,
      category: r.internalOnly ? "INTERNAL" : category,
      amount: l.amount,
    })),
    evidence: "Reviewed actual source purpose",
    reason: "Explicit component classification",
  };
}
async function confirm(
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return cashFlowConfirm(v.actor, v.proof, input, key);
}
const plus = (d: string, n: number) =>
  new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
it("actual net bank cash excludes separate fee expense, ties opening/closing, and changes no GL", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    n = await db.financeJournalEntry.count();
  let r = await report(p);
  expect(r).toMatchObject({
    externalNet: "0.00",
    unclassifiedNet: "98.00",
    difference: "98.00",
    unclassifiedCount: 1,
    classificationReady: false,
  });
  const review = await readReview(f.e.id);
  expect(review.lines).toHaveLength(1);
  expect(review.lines[0].amount).toBe("98.00");
  await confirm(await body(f.e.id));
  r = await report(p);
  expect(r).toMatchObject({
    externalNet: "98.00",
    difference: "0.00",
    classificationReady: true,
  });
  expect(r.categories.find((c) => c.category === "OPERATING")).toMatchObject({
    inflows: "98.00",
    outflows: "0.00",
    net: "98.00",
  });
  expect(await db.financeJournalEntry.count()).toBe(n);
  expect(
    BigInt(r.closingBalance.replace(".", "")) -
      BigInt(r.openingBalance.replace(".", "")),
  ).toBe(9800n);
});
it("a real mixed supplier settlement stores separate operating and investing components on the actual cash leg", async () => {
  const p = await newPeriod(),
    b = await bank(),
    supplierId = await party("SUPPLIER"),
    ap = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "PAYABLES",
    }),
    expense = await account({
      type: "OPERATING_EXPENSE",
      reportGroup: "OPERATING_EXPENSES",
    }),
    asset = await account({
      reportGroup: "NONCURRENT_ASSETS",
      controlType: "FIXED_ASSET",
    });
  const source = await bill("CREATE", {
    kind: "BILL",
    reference: prefix + " mixed bill " + ++count,
    partyId: supplierId,
    payableAccountId: ap,
    billDate: p.start,
    postingDate: p.start,
    dueDate: p.end,
    description: "Actual mixed service and asset purchase",
    evidence: "Reviewed synthetic purchase",
    lines: [
      {
        description: "Actual service",
        quantity: "1",
        unitRate: "60.00",
        treatment: "EXPENSE",
        costAccountId: expense,
      },
      {
        description: "Actual equipment",
        quantity: "1",
        unitRate: "40.01",
        treatment: "ASSET",
        costAccountId: asset,
      },
    ],
    reason: "Recognize actual mixed bill",
  });
  await bill("POST", {
    id: source.id,
    expectedVersion: source.version,
    reason: "Post actual mixed bill",
  });
  const payment = await supplier("CREATE", {
    reference: prefix + " mixed payment " + ++count,
    partyId: supplierId,
    cashAccountId: b.id,
    documentDate: p.start,
    postingDate: p.start,
    description: "Pay actual mixed bill",
    evidence: "Reviewed actual split",
    cashAmount: "100.01",
    allocations: [{ billId: source.id, amount: "100.01" }],
    reason: "Settle mixed purpose purchase",
  });
  await supplier("POST", {
    id: payment.id,
    expectedVersion: payment.version,
    reason: "Pay actual mixed purchase",
  });
  const e = await db.financeJournalEntry.findUniqueOrThrow({
      where: { supplierDocumentId: payment.id },
    }),
    v = await body(e.id),
    line = v.components[0].journalLineId;
  v.components = [
    { journalLineId: line, category: "OPERATING", amount: "60.00" },
    { journalLineId: line, category: "INVESTING", amount: "40.01" },
  ];
  await confirm(v);
  const r = await report(p);
  expect(r.categories.find((c) => c.category === "OPERATING")?.outflows).toBe(
    "60.00",
  );
  expect(r.categories.find((c) => c.category === "INVESTING")?.outflows).toBe(
    "40.01",
  );
  expect(r).toMatchObject({
    externalNet: "-100.01",
    difference: "0.00",
    classificationReady: true,
    total: 1,
  });
});
it("unreviewed net-zero transfers remain incomplete and cannot inflate operating/financing flows", async () => {
  const p = await newPeriod(),
    from = await bank(),
    to = await bank(),
    d = await movement("CREATE", {
      kind: "TRANSFER",
      reference: prefix + " transfer " + ++count,
      fromCashId: from.id,
      toCashId: to.id,
      amount: "10.01",
      documentDate: p.start,
      postingDate: p.start,
      description: "Actual internal transfer",
      evidence: "Reviewed synthetic transfer",
      reason: "Actual bank transfer",
    });
  await movement("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual transfer",
  });
  const e = await db.financeJournalEntry.findUniqueOrThrow({
    where: { movementId: d.id },
  });
  expect(await report(p)).toMatchObject({
    externalNet: "0.00",
    difference: "0.00",
    unclassifiedCount: 1,
    classificationReady: false,
  });
  const v = await body(e.id);
  await expect(
    confirm({
      ...v,
      components: v.components.map((c, i) => ({
        ...c,
        category: i ? "FINANCING" : "OPERATING",
      })),
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_FLOW_INTERNAL" });
  await confirm(v);
  expect(await report(p)).toMatchObject({
    externalNet: "0.00",
    internalNet: "0.00",
    classificationReady: true,
  });
});
it("each leg must partition exactly; a missing paisa and unmatched internal components are rejected", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    v = await body(f.e.id);
  await expect(
    confirm({ ...v, components: [{ ...v.components[0], amount: "97.99" }] }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_FLOW_TOTAL" });
  await expect(
    confirm({
      ...v,
      components: [{ ...v.components[0], category: "INTERNAL" }],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_FLOW_INTERNAL" });
  expect((await readReview(f.e.id)).review).toBeNull();
});
it("duplicate/foreign/noncash line components cannot bypass per-leg coverage", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    other = await receipt(p),
    v = await body(f.e.id),
    o = await body(other.e.id);
  await expect(
    confirm({ ...v, components: [o.components[0]] }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_FLOW_TOTAL" });
  await expect(
    confirm({ ...v, components: [...v.components, ...v.components] }),
  ).rejects.toMatchObject({ code: "FINANCE_DUPLICATE" });
  const fee = await db.financeJournalLine.findFirstOrThrow({
    where: { journalId: f.e.id, accountId: { not: f.b.gl } },
  });
  await expect(
    confirm({
      ...v,
      components: [{ ...v.components[0], journalLineId: fee.id }],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_FLOW_TOTAL" });
});
it("review replacement retains exact prior source/components, audit and permanent retry receipts", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    v = await body(f.e.id),
    key = crypto.randomUUID(),
    first = await confirm(v, key);
  expect(await confirm(v, key)).toEqual(first);
  await expect(
    confirm({ ...v, evidence: "Changed request" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  const before = await db.financeCashFlowReview.findUniqueOrThrow({
    where: { id: first.id },
    include: { components: true },
  });
  const second = await confirm(await body(f.e.id, "FINANCING"));
  const after = await db.financeCashFlowReview.findUniqueOrThrow({
    where: { id: first.id },
    include: { components: true },
  });
  expect(after).toMatchObject({
    state: "SUPERSEDED",
    version: 3,
    sourceSnapshot: before.sourceSnapshot,
    components: before.components,
  });
  expect((await readReview(f.e.id)).review?.id).toBe(second.id);
  expect(
    (await report(p)).categories.find((c) => c.category === "FINANCING")?.net,
  ).toBe("98.00");
  expect(
    await db.financeAuditEvent.count({ where: { entityId: first.id } }),
  ).toBe(1);
});
it("stale preview and version cannot replace a newer confirmed split", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    v = await body(f.e.id);
  await confirm(v);
  await expect(confirm(v)).rejects.toMatchObject({
    code: "FINANCE_STALE_VERSION",
  });
  const current = await body(f.e.id);
  await expect(
    confirm({ ...current, basisHash: "0".repeat(64) }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
});
it("dated typed reversals inherit actual opposite components and need no independent review", async () => {
  const p = await newPeriod(),
    f = await receipt(p);
  await confirm(await body(f.e.id));
  const d = await db.financeCustomerDocument.findUniqueOrThrow({
    where: { id: f.d.id },
  });
  await customer("REVERSE", {
    id: d.id,
    expectedVersion: d.version,
    postingDate: plus(p.start, 1),
    reason: "Actual dated opposite",
  });
  const rev = await db.financeCustomerDocument.findFirstOrThrow({
      where: { reversalOfId: d.id },
    }),
    e = await db.financeJournalEntry.findUniqueOrThrow({
      where: { customerDocumentId: rev.id },
    }),
    v = await readReview(e.id);
  expect(v.originalJournalId).toBe(f.e.id);
  expect(v.reviewAllowed).toBe(false);
  await expect(
    confirm({
      ...(await body(e.id)),
      expectedReviewId: null,
      expectedVersion: null,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CASH_FLOW_DERIVED" });
  const r = await report(p);
  expect(r).toMatchObject({
    externalNet: "0.00",
    difference: "0.00",
    classificationReady: true,
    total: 2,
  });
  expect(r.categories.find((c) => c.category === "OPERATING")).toMatchObject({
    inflows: "98.00",
    outflows: "98.00",
    net: "0.00",
  });
  expect(
    (await cashFlow(people.owner, { from: p.start, to: p.start })).externalNet,
  ).toBe("98.00");
});
it("a reversal posted after preview makes that preview stale, and missing original review leaves both sources incomplete", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    v = await body(f.e.id),
    d = await db.financeCustomerDocument.findUniqueOrThrow({
      where: { id: f.d.id },
    });
  await customer("REVERSE", {
    id: d.id,
    expectedVersion: d.version,
    postingDate: plus(p.start, 1),
    reason: "Actual dated opposite",
  });
  await expect(confirm(v)).rejects.toMatchObject({
    code: "FINANCE_STALE_VERSION",
  });
  expect(await report(p)).toMatchObject({
    unclassifiedCount: 2,
    difference: "0.00",
    classificationReady: false,
  });
  await confirm(await body(f.e.id));
  expect((await report(p)).classificationReady).toBe(true);
});
it("source display search never hides full company totals/readiness and date endpoints are accepted", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    a = await report(p);
  const narrow = await report(p, {
    q: "missing-source-" + crypto.randomUUID(),
  });
  expect(narrow.items).toEqual([]);
  expect(narrow.externalNet).toBe(a.externalNet);
  expect(narrow.unclassifiedCount).toBe(a.unclassifiedCount);
  expect(narrow.metadata.filters.componentDigest).toBe(
    a.metadata.filters.componentDigest,
  );
  await confirm(await body(f.e.id));
  const r = await cashFlow(people.owner, {
    from: "0001-01-01",
    to: "9999-12-31",
    page: 10000,
  });
  expect(r.page).toBe(r.pages);
  expect(r.metadata.from).toBe("0001-01-01");
});
it("cash flow source pagination is stable and totals are calculated before the 25-row display limit", async () => {
  const p = await newPeriod();
  for (let i = 0; i < 27; i++) await receipt(p, "1.01", "0.00");
  const a = await report(p),
    b = await report(p, { page: 2 });
  expect(a).toMatchObject({
    total: 27,
    page: 1,
    pages: 2,
    unclassifiedNet: "27.27",
    unclassifiedCount: 27,
  });
  expect(a.items).toHaveLength(25);
  expect(b.items).toHaveLength(2);
  expect(new Set([...a.items, ...b.items].map((i) => i.journalId)).size).toBe(
    27,
  );
  expect(b.unclassifiedNet).toBe("27.27");
}, 30000);
it("retained review and component rows reject direct mutation/deletion and no incomplete draft can commit", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    r = await confirm(await body(f.e.id)),
    c = await db.financeCashFlowComponent.findFirstOrThrow({
      where: { reviewId: r.id },
    });
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await expect(
      sql.query('DELETE FROM "FinanceCashFlowReview" WHERE id=$1', [r.id]),
    ).rejects.toMatchObject({ message: "FINANCE_CASH_FLOW_RETAINED" });
    await expect(
      sql.query(
        'UPDATE "FinanceCashFlowComponent" SET amount=amount+1 WHERE id=$1',
        [c.id],
      ),
    ).rejects.toMatchObject({ message: "FINANCE_CASH_FLOW_RETAINED" });
  } finally {
    await sql.end();
  }
});
it("current selected administrator can classify; ordinary employees and unselected Super Admin cannot read or write", async () => {
  const p = await newPeriod(),
    f = await receipt(p);
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(readReview(f.e.id, who)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      confirm(await body(f.e.id), crypto.randomUUID(), who),
    ).rejects.toMatchObject({ status: 403 });
  }
  await confirm(await body(f.e.id), crypto.randomUUID(), "selected");
  expect((await readReview(f.e.id, "selected")).review).toBeTruthy();
});
it("a closed linked reversal period blocks changing an otherwise open original classification", async () => {
  const p = await newPeriod(),
    f = await receipt(p);
  await confirm(await body(f.e.id));
  const q = await newPeriod(),
    d = await db.financeCustomerDocument.findUniqueOrThrow({
      where: { id: f.d.id },
    });
  await customer("REVERSE", {
    id: d.id,
    expectedVersion: d.version,
    postingDate: q.start,
    reason: "Actual later period reversal",
  });
  const input = await body(f.e.id, "FINANCING"),
    sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    const session = (
      await sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [people.owner.authUserId],
      )
    ).rows[0];
    await sql.query("BEGIN");
    await sql.query(
      'ALTER TABLE "FinancePeriod" DISABLE TRIGGER "FinancePeriod_guard"',
    );
    await sql.query(
      `UPDATE "FinancePeriod" SET state='CLOSED',"closedAt"=CURRENT_TIMESTAMP,"closedById"=$2 WHERE id=$1`,
      [q.id, people.owner.id],
    );
    await expect(
      sql.query(
        "SELECT encova_finance_cash_flow_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'CONFIRM',$3,$4,$5)",
        [
          people.owner.id,
          session.id,
          JSON.stringify(input),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ message: "FINANCE_PERIOD_CLOSED" });
  } finally {
    await sql.query("ROLLBACK");
    await sql.end();
  }
  expect((await report(p)).externalNet).toBe("98.00");
  expect((await report(q)).externalNet).toBe("-98.00");
});
it("a committed incomplete draft is rejected independently of the command service", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    r = await confirm(await body(f.e.id)),
    sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("BEGIN");
    await sql.query(
      'INSERT INTO "FinanceCashFlowReview"(id,"journalId",evidence,reason,"sourceHash","sourceSnapshot","createdById") SELECT gen_random_uuid(),"journalId",evidence,reason,"sourceHash","sourceSnapshot","createdById" FROM "FinanceCashFlowReview" WHERE id=$1',
      [r.id],
    );
    await expect(
      sql.query("SET CONSTRAINTS ALL IMMEDIATE"),
    ).rejects.toMatchObject({ message: "FINANCE_CASH_FLOW_INCOMPLETE" });
  } finally {
    await sql.query("ROLLBACK");
    await sql.end();
  }
});
it("expired proofs, revoked grants, disabled feature and public SQL roles stay denied", async () => {
  const p = await newPeriod(),
    f = await receipt(p),
    input = await body(f.e.id),
    v = await proof("selected");
  const expiredSql = new pg.Client({ connectionString: url });
  await expiredSql.connect();
  try {
    await expect(
      expiredSql.query(
        "SELECT encova_finance_cash_flow_command($1,'better-auth','irrelevant',CURRENT_TIMESTAMP-interval '6 minutes','CONFIRM',$2,$3,$4)",
        [
          people.owner.id,
          JSON.stringify(input),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ message: "FINANCE_REAUTH_REQUIRED" });
  } finally {
    await expiredSql.end();
  }
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  await expect(
    cashFlowConfirm(v.actor, v.proof, input, crypto.randomUUID()),
  ).rejects.toMatchObject({ status: 403 });
  env.FINANCE_ENABLED = false;
  await expect(readReview(f.e.id)).rejects.toMatchObject({ status: 404 });
  env.FINANCE_ENABLED = true;
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"]) {
      for (const fn of [
        "encova_finance_cash_flow_source(uuid)",
        "encova_finance_cash_flow_lines(date)",
        "encova_finance_cash_flow_validate(uuid)",
      ]) {
        expect(
          (
            await sql.query(
              "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
              [role, fn],
            )
          ).rows[0].allowed,
        ).toBe(false);
      }
    }
    expect(
      (
        await sql.query(
          `SELECT has_table_privilege('encova_app','"FinanceCashFlowReview"','INSERT') AS allowed`,
        )
      ).rows[0].allowed,
    ).toBe(false);
  } finally {
    await sql.end();
  }
});
it("actual capital cash is financing when reviewed while an actual noncash capital contribution creates no cash group", async () => {
  const p = await newPeriod(),
    b = await bank(),
    contributor = await party("OTHER"),
    capital = await account({
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
      controlType: "CAPITAL",
    }),
    asset = await account({ reportGroup: "NONCURRENT_ASSETS" });
  for (const kind of ["CAPITAL_CONTRIBUTION", "NONCASH_CAPITAL"]) {
    const d = await movement("CREATE", {
      kind,
      reference: prefix + " funding " + ++count,
      documentDate: p.start,
      postingDate: p.start,
      description: "Actual synthetic cash/noncash capital",
      evidence: "Reviewed actual source classification",
      amount: "200.01",
      toCashId: kind === "CAPITAL_CONTRIBUTION" ? b.id : null,
      partyId: contributor,
      controlAccountId: capital,
      counterAccountId: kind === "NONCASH_CAPITAL" ? asset : null,
      approvalEvidence:
        kind === "NONCASH_CAPITAL"
          ? "Reviewed exact noncash property contribution"
          : null,
      reason: "Explicit actual capital source",
    });
    await movement("POST", {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post actual capital source",
    });
    if (kind === "CAPITAL_CONTRIBUTION") {
      const e = await db.financeJournalEntry.findUniqueOrThrow({
        where: { movementId: d.id },
      });
      await confirm(await body(e.id, "FINANCING"));
    }
  }
  const r = await report(p);
  expect(r).toMatchObject({
    total: 1,
    externalNet: "200.01",
    classificationReady: true,
  });
  expect(r.categories.find((c) => c.category === "FINANCING")?.inflows).toBe(
    "200.01",
  );
  expect(r.categories.find((c) => c.category === "OPERATING")?.net).toBe(
    "0.00",
  );
});
it("archiving cash masters preserves the original review basis and actual cash history", async () => {
  const p = await newPeriod(),
    f = await receipt(p);
  await confirm(await body(f.e.id));
  const before = await readReview(f.e.id),
    b = await db.financeCashAccount.findUniqueOrThrow({
      where: { id: f.b.id },
    });
  await master("CASH_ARCHIVE", {
    id: b.id,
    expectedVersion: b.version,
    reason: "Retain archived bank history",
  });
  const a = await db.financeAccount.findUniqueOrThrow({
    where: { id: f.b.gl },
  });
  await config("ACCOUNT_ARCHIVE", {
    id: a.id,
    expectedVersion: a.version,
    reason: "Retain archived cash control history",
  });
  const after = await readReview(f.e.id);
  expect(after.basisHash).toBe(before.basisHash);
  expect(after.lines[0].active).toBe(false);
  expect(await report(p)).toMatchObject({
    externalNet: "98.00",
    classificationReady: true,
    difference: "0.00",
  });
});
