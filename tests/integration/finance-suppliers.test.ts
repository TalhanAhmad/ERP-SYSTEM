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
const {billCommand,billDetail}=await import("@/modules/finance/payables/service");
const { supplierCommand, supplierDetail, suppliers } =
  await import("@/modules/finance/payables/supplier/service");
const { supplierRead, supplierMutation } =
  await import("@/modules/finance/payables/supplier/http");
let advance: string;
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "S17." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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
  advance = await account({ controlType: "SUPPLIER_ADVANCE" });
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
const day = (n: number) =>
  new Date(new Date(period.start).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
it("denies every lower role and unselected root before supplier document or options disclosure", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(
      suppliers(people[who], "PAYMENT", { invalid: true }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    expect((await supplierRead(req(who), "PAYMENT")).status).toBe(403);
    expect(
      (
        await supplierMutation(
          req(who, { ...payment(), reauth: { password } }),
          "PAYMENT",
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
});
it("partial and multiple bill payment debits AP and credits bank once", async () => {
  const a = await posted({ lines: [line({ unitRate: "75" })] }),
    b = await posted({ lines: [line({ unitRate: "90" })] });
  const d = await post(
    "PAYMENT",
    payment([
      { billId: a.item.id, amount: "50.00" },
      { billId: b.item.id, amount: "50.00" },
    ]),
  );
  expect(d.item.totalAmount).toBe("100.00");
  expect(d.item.entry!.lines.map((l) => [l.debit, l.credit])).toEqual([
    ["0.00", "100.00"],
    ["50.00", "0.00"],
    ["50.00", "0.00"],
  ]);
  expect((await billDetail(people.owner, a.item.id)).payableBalance).toBe(
    "25.00",
  );
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "40.00",
  );
});
it("immediate paid expense cannot be selected for a second supplier payment", async () => {
  const a = await posted({
    kind: "EXPENSE",
    payableAccountId: null,
    cashAccountId: cash,
  });
  const d = await movement(
    "PAYMENT",
    "CREATE",
    payment([{ billId: a.item.id, amount: "100.00" }]),
  );
  await expect(
    movement("PAYMENT", "POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Prevent double payment",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ALLOCATION_UNAVAILABLE" });
});
it("standalone advance is an asset and application clears AP without another cash leg", async () => {
  const a = await post("PAYMENT", payment()),
    b = await posted({ lines: [line({ unitRate: "80" })] });
  expect(a.availableAdvance).toBe("100.00");
  expect(
    a.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [
      (await db.financeCashAccount.findUniqueOrThrow({ where: { id: cash } }))
        .glAccountId,
      "0.00",
      "100.00",
    ],
    [advance, "100.00", "0.00"],
  ]);
  const app = await post(
    "ADVANCE_APPLICATION",
    base({
      sourceDocumentId: a.item.id,
      allocations: [{ billId: b.item.id, amount: "80.00" }],
    }),
  );
  expect(
    app.item.entry!.lines.every(
      (l) => l.accountId !== a.item.entry!.lines[0].accountId,
    ),
  ).toBe(true);
  expect(
    (await supplierDetail(people.owner, "PAYMENT", a.item.id)).availableAdvance,
  ).toBe("20.00");
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "0.00",
  );
  await expect(
    movement("PAYMENT", "REVERSE", {
      id: a.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Consumed advance blocked",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
});
it("mixed settlement preserves supplier advance identity and rejects wrong supplier use", async () => {
  const b = await posted({ lines: [line({ unitRate: "25" })] }),
    p = await post(
      "PAYMENT",
      payment([{ billId: b.item.id, amount: "25.00" }], {
        advanceAccountId: advance,
      }),
    );
  expect(p.availableAdvance).toBe("75.00");
  const other = await party(),
    d = await movement(
      "SUPPLIER_REFUND",
      "CREATE",
      base({
        partyId: other,
        sourceDocumentId: p.item.id,
        cashAccountId: cash,
        cashAmount: "10.00",
      }),
    );
  await expect(
    movement("SUPPLIER_REFUND", "POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Party mismatch",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
});
it("unpaid supplier credit reverses original discounted cost and reduces AP only", async () => {
  const b = await posted({
      lines: [line({ unitRate: "120", discountAmount: "20" })],
    }),
    credit = await post(
      "SUPPLIER_CREDIT",
      base({
        billId: b.item.id,
        advanceAccountId: advance,
        creditLines: [{ billLineId: b.item.lines[0].id, amount: "40.00" }],
      }),
    );
  expect(credit.item.creditSplit).toMatchObject({
    arAmount: "40.00",
    balanceAmount: "0.00",
  });
  expect(
    credit.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [ar, "40.00", "0.00"],
    [revenue, "0.00", "40.00"],
  ]);
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "60.00",
  );
});
it("paid supplier credit becomes recoverable asset and cash refund clears it without expense", async () => {
  const b = await posted({ lines: [line({ unitRate: "100" })] });
  await post("PAYMENT", payment([{ billId: b.item.id, amount: "100.00" }]));
  const c = await post(
    "SUPPLIER_CREDIT",
    base({
      billId: b.item.id,
      advanceAccountId: advance,
      creditLines: [{ billLineId: b.item.lines[0].id, amount: "30.00" }],
    }),
  );
  expect(c.availableAdvance).toBe("30.00");
  const r = await post(
    "SUPPLIER_REFUND",
    base({
      sourceDocumentId: c.item.id,
      cashAccountId: cash,
      cashAmount: "30.00",
    }),
  );
  expect(r.item.entry!.lines.every((l) => l.accountId !== revenue)).toBe(true);
  expect(
    (await supplierDetail(people.owner, "SUPPLIER_CREDIT", c.item.id))
      .availableAdvance,
  ).toBe("0.00");
  await movement("SUPPLIER_REFUND", "REVERSE", {
    id: r.item.id,
    expectedVersion: 2,
    postingDate: period.start,
    reason: "Reverse refund",
  });
  expect(
    (await supplierDetail(people.owner, "SUPPLIER_CREDIT", c.item.id))
      .availableAdvance,
  ).toBe("30.00");
});
it("caps credits at original discounted line amount and blocks source mismatches", async () => {
  const b = await posted({
      lines: [line({ unitRate: "50", discountAmount: "10" })],
    }),
    d = await movement(
      "SUPPLIER_CREDIT",
      "CREATE",
      base({
        billId: b.item.id,
        advanceAccountId: advance,
        creditLines: [{ billLineId: b.item.lines[0].id, amount: "40.01" }],
      }),
    );
  await expect(
    movement("SUPPLIER_CREDIT", "POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Overcredit blocked",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CREDIT_UNAVAILABLE" });
  expect(
    (await supplierDetail(people.owner, "SUPPLIER_CREDIT", d.id)).item.entry,
  ).toBeNull();
});
it("concurrent over-allocation posts only one complete payment and replays exactly", async () => {
  const b = await posted({ lines: [line({ unitRate: "100" })] }),
    a = await movement(
      "PAYMENT",
      "CREATE",
      payment([{ billId: b.item.id, amount: "100.00" }]),
    ),
    c = await movement(
      "PAYMENT",
      "CREATE",
      payment([{ billId: b.item.id, amount: "100.00" }]),
    ),
    key = crypto.randomUUID(),
    args = { id: a.id, expectedVersion: 1, reason: "Concurrent payment" };
  const results = await Promise.allSettled([
    movement("PAYMENT", "POST", args, key),
    movement("PAYMENT", "POST", { ...args, id: c.id }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "0.00",
  );
  if (results[0].status === "fulfilled")
    expect(await movement("PAYMENT", "POST", args, key)).toEqual(
      results[0].value,
    );
});
it("dated payment capacity preserves later allocations and rejects backdated overpayment", async () => {
  const b = await posted({ lines: [line({ unitRate: "100" })] });
  await post(
    "PAYMENT",
    payment([{ billId: b.item.id, amount: "100.00" }], {
      documentDate: day(3),
      postingDate: day(3),
    }),
  );
  const p = await movement(
    "PAYMENT",
    "CREATE",
    payment([{ billId: b.item.id, amount: "100.00" }], {
      documentDate: day(1),
      postingDate: day(1),
    }),
  );
  await expect(
    movement("PAYMENT", "POST", {
      id: p.id,
      expectedVersion: 1,
      reason: "Later funds reserved",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ALLOCATION_UNAVAILABLE" });
});
it("dated advance capacity preserves later applications and refunds", async () => {
  const p = await post("PAYMENT", payment());
  await post(
    "SUPPLIER_REFUND",
    base({
      sourceDocumentId: p.item.id,
      cashAccountId: cash,
      cashAmount: "100.00",
      documentDate: day(3),
      postingDate: day(3),
    }),
  );
  const r = await movement(
    "SUPPLIER_REFUND",
    "CREATE",
    base({
      sourceDocumentId: p.item.id,
      cashAccountId: cash,
      cashAmount: "1.00",
      documentDate: day(1),
      postingDate: day(1),
    }),
  );
  await expect(
    movement("SUPPLIER_REFUND", "POST", {
      id: r.id,
      expectedVersion: 1,
      reason: "Later refund reserved",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
});
it("release and correction retain cash and enforce ordered reversal of original payment", async () => {
  const b = await posted({ lines: [line({ unitRate: "100" })] }),
    p = await post(
      "PAYMENT",
      payment([{ billId: b.item.id, amount: "100.00" }]),
    );
  const u = await movement("PAYMENT", "UNALLOCATE", {
    id: p.item.id,
    expectedVersion: 2,
    postingDate: period.start,
    advanceAccountId: advance,
    reason: "Release wrong settlement",
  });
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "100.00",
  );
  await expect(
    movement("PAYMENT", "REVERSE", {
      id: p.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Active release",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_SETTLEMENT_UNAVAILABLE" });
  await movement("UNALLOCATION", "REVERSE", {
    id: u.id,
    expectedVersion: 2,
    postingDate: period.start,
    reason: "Undo release",
  });
  await movement("PAYMENT", "REVERSE", {
    id: p.item.id,
    expectedVersion: 2,
    postingDate: period.start,
    reason: "Undo payment",
  });
  expect(
    (await supplierDetail(people.owner, "PAYMENT", p.item.id)).item.state,
  ).toBe("REVERSED");
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "100.00",
  );
});
it("private supplier commands require current session and expose no runtime DML or helper execution", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    const r = await sql.query(
      `SELECT has_table_privilege(current_user,'"FinanceSupplierDocument"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_supplier_validate(uuid)','EXECUTE') AS helper,has_function_privilege(current_user,'encova_finance_supplier_command(uuid,text,text,timestamptz,text,text,jsonb,text,uuid)','EXECUTE') AS command`,
    );
    expect(r.rows[0]).toEqual({ write: false, helper: false, command: true });
  } finally {
    await sql.end();
  }
});
