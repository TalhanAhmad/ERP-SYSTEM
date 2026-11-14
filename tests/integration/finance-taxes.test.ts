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
const { supplierCommand, supplierDetail } =
  await import("@/modules/finance/payables/supplier/service");
const { customerCommand, customerDetail } =
  await import("@/modules/finance/receivables/customer/service");
const { taxCommand, taxCodes } =
  await import("@/modules/finance/taxes/service");
const { invoiceCommand, invoiceDetail } =
  await import("@/modules/finance/receivables/service");
let advance: string,
  inputTax: string,
  outputTax: string,
  whtAR: string,
  whtAP: string,
  salesAR: string,
  salesIncome: string;
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "T18." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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
  kind: "BOTH",
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
  advance = await account({ controlType: "SUPPLIER_ADVANCE" });
  inputTax = await account({ controlType: "TAX_INPUT" });
  outputTax = await account({
    controlType: "TAX_OUTPUT",
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
  });
  whtAR = await account({ controlType: "WITHHOLDING_RECEIVABLE" });
  whtAP = await account({
    controlType: "WITHHOLDING_PAYABLE",
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
  });
  salesAR = await account({ controlType: "RECEIVABLES" });
  salesIncome = await account({
    type: "INCOME",
    normalSide: "CREDIT",
    reportGroup: "REVENUE",
  });
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

async function movement(
  resource: Parameters<typeof supplierCommand>[2],
  action: Parameters<typeof supplierCommand>[3],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return supplierCommand(v.actor, v.proof, resource, action, body, key);
}
const base = (patch: Record<string, unknown> = {}) => ({
  reference: prefix + "." + ++count,
  partyId: client,
  projectId: null,
  documentDate: period.start,
  postingDate: period.start,
  description: "Synthetic supplier movement",
  evidence: "Fixture only",
  currency: "PKR",
  reason: "Reviewed supplier movement",
  ...patch,
});
const payment = (
  allocations: { billId: string; amount: string }[] = [],
  patch: Record<string, unknown> = {},
) =>
  base({
    cashAccountId: cash,
    cashAmount: "100.00",
    feeAmount: "0.00",
    feeAccountId: null,
    advanceAccountId: allocations.length ? null : advance,
    allocations,
    ...patch,
  });
async function post(
  resource: Parameters<typeof supplierCommand>[2],
  input: unknown,
) {
  const d = await movement(resource, "CREATE", input);
  await movement(resource, "POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post reviewed movement",
  });
  return supplierDetail(people.owner, resource, d.id);
}
async function policy(patch: Record<string, unknown> = {}, who = "owner") {
  const v = await proof(who);
  return taxCommand(
    v.actor,
    v.proof,
    "CREATE",
    {
      code: prefix + "." + ++count,
      name: "Synthetic reviewed policy",
      kind: "INDIRECT",
      effectiveFrom: period.start,
      effectiveTo: period.end,
      rate: "10",
      mode: "EXCLUSIVE",
      rounding: "HALF_UP",
      inputAccountId: inputTax,
      outputAccountId: outputTax,
      policyEvidence: "Synthetic test policy only; no legal rate inferred",
      reason: "Explicit synthetic policy",
      ...patch,
    },
    crypto.randomUUID(),
  );
}
const inv = (patch: Record<string, unknown> = {}) => ({
  reference: prefix + "." + ++count,
  partyId: client,
  receivableAccountId: salesAR,
  invoiceDate: period.start,
  postingDate: period.start,
  dueDate: period.end,
  description: "Synthetic taxed service",
  evidence: "Fixture evidence",
  reason: "Reviewed service",
  lines: [
    {
      description: "Service",
      quantity: "1",
      unitRate: "100",
      discountAmount: "0",
      recognition: "EARNED",
      revenueAccountId: salesIncome,
    },
  ],
  ...patch,
});
async function invoice(input: unknown) {
  let v = await proof();
  const d = await invoiceCommand(
    v.actor,
    v.proof,
    "CREATE",
    input,
    crypto.randomUUID(),
  );
  v = await proof();
  await invoiceCommand(
    v.actor,
    v.proof,
    "POST",
    { id: d.id, expectedVersion: 1, reason: "Reviewed taxed invoice" },
    crypto.randomUUID(),
  );
  return invoiceDetail(people.owner, d.id);
}
async function cust(
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
async function customerPost(
  resource: Parameters<typeof customerCommand>[2],
  input: unknown,
) {
  const d = await cust(resource, "CREATE", input);
  await cust(resource, "POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Reviewed customer tax document",
  });
  return customerDetail(people.owner, resource, d.id);
}
it("only current Finance Owner changes tax policy; selected roots may privately read it", async () => {
  await expect(policy({}, "selected")).rejects.toMatchObject({
    code: "FINANCE_FORBIDDEN",
  });
  await expect(
    taxCodes(people.member, { invalid: true }),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  const p = await policy();
  expect(
    (await taxCodes(people.selected, { q: prefix })).items.some(
      (i) => i.id === p.id,
    ),
  ).toBe(true);
});
it("exclusive invoice separates net revenue and output tax with exact policy snapshot", async () => {
  const p = await policy(),
    d = await invoice(inv({ lines: [{ ...inv().lines[0], taxCodeId: p.id }] }));
  expect(d.item).toMatchObject({
    netAmount: "100.00",
    taxAmount: "10.00",
    totalAmount: "110.00",
  });
  expect(d.item.lines[0].taxSnapshot).toMatchObject({
    rate: "10.000000",
    mode: "EXCLUSIVE",
    rounding: "HALF_UP",
  });
  expect(
    d.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [salesAR, "110.00", "0.00"],
    [salesIncome, "0.00", "100.00"],
    [outputTax, "0.00", "10.00"],
  ]);
});
it("inclusive discounted deferred invoice and partial credit retain only net deferred revenue", async () => {
  const p = await policy({ mode: "INCLUSIVE" }),
    held = await account({
      controlType: "CLIENT_ADVANCE",
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    deferred = await account({
      controlType: "DEFERRED_REVENUE",
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    d = await invoice(
      inv({
        lines: [
          {
            ...inv().lines[0],
            unitRate: "121",
            discountAmount: "11",
            recognition: "DEFERRED",
            deferredAccountId: deferred,
            taxCodeId: p.id,
          },
        ],
      }),
    );
  expect(d.item).toMatchObject({
    lineAmount: "121.00",
    discountAmount: "11.00",
    netAmount: "100.00",
    taxAmount: "10.00",
    totalAmount: "110.00",
  });
  expect(d.deferredEvents[0].amount).toBe("100.00");
  const c = await customerPost(
    "CUSTOMER_CREDIT",
    base({
      invoiceId: d.item.id,
      advanceAccountId: held,
      creditLines: [{ invoiceLineId: d.item.lines[0].id, amount: "55.00" }],
    }),
  );
  expect(
    c.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [salesAR, "0.00", "55.00"],
    [deferred, "50.00", "0.00"],
    [outputTax, "5.00", "0.00"],
  ]);
  expect(
    (await invoiceDetail(people.owner, d.item.id)).deferredEvents.map(
      (e) => e.amount,
    ),
  ).toEqual(expect.arrayContaining(["100.00", "-50.00"]));
});
it("taxed bill separates input tax and original cost; paid credit/refund recovers both", async () => {
  const p = await policy(),
    b = await posted({ lines: [line({ unitRate: "100", taxCodeId: p.id })] });
  expect(b.item).toMatchObject({
    netAmount: "100.00",
    taxAmount: "10.00",
    totalAmount: "110.00",
  });
  expect(
    b.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [ar, "0.00", "110.00"],
    [revenue, "100.00", "0.00"],
    [inputTax, "10.00", "0.00"],
  ]);
  await post(
    "PAYMENT",
    payment([{ billId: b.item.id, amount: "110.00" }], {
      cashAmount: "110.00",
    }),
  );
  const c = await post(
    "SUPPLIER_CREDIT",
    base({
      billId: b.item.id,
      advanceAccountId: advance,
      creditLines: [{ billLineId: b.item.lines[0].id, amount: "55.00" }],
    }),
  );
  expect(c.availableAdvance).toBe("55.00");
  expect(
    c.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [advance, "55.00", "0.00"],
    [revenue, "0.00", "50.00"],
    [inputTax, "0.00", "5.00"],
  ]);
  const r = await post(
    "SUPPLIER_REFUND",
    base({
      sourceDocumentId: c.item.id,
      cashAccountId: cash,
      cashAmount: "55.00",
    }),
  );
  expect(r.availableAdvance).toBe("0.00");
});
it("customer withholding participates in gross settlement without becoming a fee", async () => {
  const p = await policy({
      kind: "WITHHOLDING",
      inputAccountId: whtAR,
      outputAccountId: whtAP,
      rate: "2",
    }),
    d = await invoice(inv()),
    r = await customerPost(
      "RECEIPT",
      base({
        cashAccountId: cash,
        cashAmount: "98.00",
        feeAmount: "0.00",
        withholdingAmount: "2.00",
        withholdingCodeId: p.id,
        allocations: [{ invoiceId: d.item.id, amount: "100.00" }],
      }),
    );
  expect(r.item.withholdingAmount).toBe("2.00");
  expect(
    r.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [
      (await db.financeCashAccount.findUniqueOrThrow({ where: { id: cash } }))
        .glAccountId,
      "98.00",
      "0.00",
    ],
    [whtAR, "2.00", "0.00"],
    [salesAR, "0.00", "100.00"],
  ]);
  expect((await invoiceDetail(people.owner, d.item.id)).receivableBalance).toBe(
    "0.00",
  );
});
it("supplier withholding credits its liability and clears gross AP with less cash", async () => {
  const p = await policy({
      kind: "WITHHOLDING",
      inputAccountId: whtAR,
      outputAccountId: whtAP,
      rate: "2",
    }),
    b = await posted({ lines: [line({ unitRate: "100" })] }),
    r = await post(
      "PAYMENT",
      payment([{ billId: b.item.id, amount: "100.00" }], {
        cashAmount: "98.00",
        withholdingAmount: "2.00",
        withholdingCodeId: p.id,
      }),
    );
  expect(
    r.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [
      (await db.financeCashAccount.findUniqueOrThrow({ where: { id: cash } }))
        .glAccountId,
      "0.00",
      "98.00",
    ],
    [whtAP, "0.00", "2.00"],
    [ar, "100.00", "0.00"],
  ]);
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "0.00",
  );
});
it("supports an evidenced withholding-only settlement with no zero-value cash journal", async () => {
  const p = await policy({
      kind: "WITHHOLDING",
      inputAccountId: whtAR,
      outputAccountId: whtAP,
      rate: "100",
    }),
    b = await posted({ lines: [line({ unitRate: "10" })] }),
    r = await post(
      "PAYMENT",
      payment([{ billId: b.item.id, amount: "10.00" }], {
        cashAmount: "0.00",
        withholdingAmount: "10.00",
        withholdingCodeId: p.id,
      }),
    );
  expect(r.item.entry!.lines).toHaveLength(2);
});
it("configurable rounding preserves original tax across the final-cent credit and reversals", async () => {
  const p = await policy({ rate: "50" }),
    deferred = await account({
      controlType: "DEFERRED_REVENUE",
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    held = await account({
      controlType: "CLIENT_ADVANCE",
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    d = await invoice(
      inv({
        lines: [
          {
            ...inv().lines[0],
            unitRate: "0.02",
            recognition: "DEFERRED",
            deferredAccountId: deferred,
            taxCodeId: p.id,
          },
        ],
      }),
    );
  expect(d.item.totalAmount).toBe("0.03");
  const docs = [];
  for (let n = 0; n < 3; n++)
    docs.push(
      await customerPost(
        "CUSTOMER_CREDIT",
        base({
          invoiceId: d.item.id,
          advanceAccountId: held,
          creditLines: [{ invoiceLineId: d.item.lines[0].id, amount: "0.01" }],
        }),
      ),
    );
  const tax = docs
    .flatMap((x) => x.item.entry!.lines)
    .filter((l) => l.accountId === outputTax)
    .reduce((sum, l) => sum + Number(l.debit), 0);
  expect(tax).toBe(0.01);
  expect((await invoiceDetail(people.owner, d.item.id)).receivableBalance).toBe(
    "0.00",
  );
});
it("round-down policy, effective dates, retired policies and overlapping versions remain explicit", async () => {
  const p = await policy({ rate: "10", rounding: "DOWN" }),
    d = await invoice(
      inv({
        lines: [{ ...inv().lines[0], unitRate: "0.05", taxCodeId: p.id }],
      }),
    );
  expect(d.item.taxAmount).toBe("0.00");
  const v = await proof();
  await taxCommand(
    v.actor,
    v.proof,
    "RETIRE",
    { id: p.id, reason: "Retire test policy" },
    crypto.randomUUID(),
  );
  expect(
    (await invoiceDetail(people.owner, d.item.id)).item.lines[0].taxSnapshot,
  ).toHaveProperty("rounding", "DOWN");
  let proof2 = await proof();
  const draft = await invoiceCommand(
    proof2.actor,
    proof2.proof,
    "CREATE",
    inv(),
    crypto.randomUUID(),
  );
  proof2 = await proof();
  await expect(
    invoiceCommand(
      proof2.actor,
      proof2.proof,
      "UPDATE",
      {
        ...inv({ lines: [{ ...inv().lines[0], taxCodeId: p.id }] }),
        id: draft.id,
        expectedVersion: 1,
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_TAX_MAPPING" });
  await expect(policy({ code: p.code })).rejects.toMatchObject({
    code: "FINANCE_DUPLICATE_TAX_CODE",
  });
});
it("null optional tax fields preserve the permanent pre-tax idempotency digest", async () => {
  const input = inv(),
    v = await proof(),
    key = crypto.randomUUID(),
    d = await invoiceCommand(v.actor, v.proof, "CREATE", input, key),
    v2 = await proof();
  expect(
    await invoiceCommand(v2.actor, v2.proof, "CREATE", input, key),
  ).toEqual(d);
  const { invoiceSchemas } =
    await import("@/modules/finance/receivables/schemas");
  const old = invoiceSchemas.CREATE.parse(input);
  const lines = old.lines.map(({ taxCodeId, ...l }) => {
    void taxCodeId;
    return l;
  });
  const expected = await db.$queryRaw<
    { hash: string }[]
  >`SELECT encode(sha256(convert_to(${JSON.stringify({ ...old, lines })}::jsonb::text,'UTF8')),'hex') AS hash`;
  expect(
    (
      await db.financeLedgerReceipt.findFirstOrThrow({
        where: { actorId: v.actor.id, key, operation: "INVOICE_CREATE" },
      })
    ).requestHash,
  ).toBe(expected[0].hash);
});

it("retired policy cannot post an existing draft but original taxed withholding reversal retains its snapshot", async () => {
  const p = await policy({
      kind: "WITHHOLDING",
      inputAccountId: whtAR,
      outputAccountId: whtAP,
      rate: "2",
    }),
    b = await posted({ lines: [line({ unitRate: "100" })] }),
    r = await post(
      "PAYMENT",
      payment([{ billId: b.item.id, amount: "100.00" }], {
        cashAmount: "98.00",
        withholdingAmount: "2.00",
        withholdingCodeId: p.id,
      }),
    );
  const v = await proof();
  await taxCommand(
    v.actor,
    v.proof,
    "RETIRE",
    { id: p.id, reason: "Retire reviewed synthetic code" },
    crypto.randomUUID(),
  );
  await movement("PAYMENT", "REVERSE", {
    id: r.item.id,
    expectedVersion: 2,
    postingDate: period.end,
    reason: "Reverse original evidenced withholding",
  });
  expect(
    (
      await supplierDetail(people.owner, "PAYMENT", r.item.id)
    ).item.reversedBy!.entry!.lines.map((l) => [
      l.accountId,
      l.debit,
      l.credit,
    ]),
  ).toEqual(r.item.entry!.lines.map((l) => [l.accountId, l.credit, l.debit]));
});
it("tax controls cannot be posted through arbitrary journals and runtime cannot edit policies or tax splits", async () => {
  const { ledgerCommand } = await import("@/modules/finance/ledger/service");
  const v = await proof(),
    draft = await ledgerCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        reference: prefix + " protected tax",
        postingDate: period.start,
        description: "Typed source required",
        evidence: "Synthetic control test",
        reason: "Reject arbitrary tax posting",
        lines: [
          { accountId: inputTax, description: "Tax", debit: "10", credit: "0" },
          {
            accountId: salesIncome,
            description: "Income",
            debit: "0",
            credit: "10",
          },
        ],
      },
      crypto.randomUUID(),
    );
  const fresh = await proof();
  await expect(
    ledgerCommand(
      fresh.actor,
      fresh.proof,
      "POST",
      {
        id: draft.id,
        expectedVersion: 1,
        reason: "Reject arbitrary tax posting",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_CONTROL_PROTECTED" });
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    for (const input of [{ lines: [] }, { lines: [null, "scalar", 2] }]) {
      const rows = await sql.query(
        "SELECT encova_finance_optional_tax_digest($1::jsonb) AS digest",
        [JSON.stringify(input)],
      );
      expect(rows.rows[0].digest).toMatch(/^[a-f0-9]{64}$/);
    }
    await sql.query("SET ROLE encova_app");
    const r = await sql.query(
      `SELECT has_table_privilege(current_user,'"FinanceTaxCode"','INSERT') AS policy_write,has_table_privilege(current_user,'"FinanceCreditTaxSplit"','INSERT') AS split_write,has_function_privilege(current_user,'encova_finance_tax_quote(uuid,text,date,numeric,numeric)','EXECUTE') AS helper,has_function_privilege(current_user,'encova_finance_tax_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command`,
    );
    expect(r.rows[0]).toEqual({
      policy_write: false,
      split_write: false,
      helper: false,
      command: true,
    });
  } finally {
    await sql.end();
  }
});
