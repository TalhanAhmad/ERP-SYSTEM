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
  prefix = "I23." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

const { holdingCommand, holdingDetail, holdings, investmentLots } =
  await import("@/modules/finance/investments/service");
const { holdingRead, holdingMutation } =
  await import("@/modules/finance/investments/http");
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
it("pending policy holdings are flagged and cannot post, while metadata itself creates no GL", async () => {
  const h = await holding({ policyStatus: "PENDING" }),
    bank = (await banks()).a,
    d = await move("CREATE", acquisition(h, bank.id));
  expect(
    (await holdings(people.owner, { q: h.body.name })).items[0].policyStatus,
  ).toBe("PENDING");
  expect((await holdingDetail(people.owner, h.id)).carryingValue).toBe("0.00");
  await expect(
    move("POST", { id: d.id, expectedVersion: 1, reason: "Unreviewed policy" }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_POLICY" });
  expect(
    await db.financeJournalEntry.count({ where: { movementId: d.id } }),
  ).toBe(0);
});
it("acquisition creates one original lot, matching investment debit/cash credit and reviewed source snapshot", async () => {
  const h = await holding(),
    bank = (await banks()).a,
    d = await postAcquisition(acquisition(h, bank.id)),
    lot = await db.financeInvestmentLot.findUniqueOrThrow({
      where: { movementId: d.item.id },
    });
  expect(lot.cost.toFixed(2)).toBe("100.01");
  expect(lot.units?.toFixed(6)).toBe("3.000001");
  expect(
    d.item.entry!.lines.find((l) => l.accountId === h.body.investmentAccountId)
      ?.debit,
  ).toBe("100.01");
  expect(d.item.entry!.lines.find((l) => l.accountId === bank.gl)?.credit).toBe(
    "100.01",
  );
  expect(d.item.sourceSnapshot).toHaveProperty("holding.policy", h.body.policy);
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    originalCost: "100.01",
    carryingValue: "100.01",
    units: "3.000001",
  });
});
it("additional purchases retain separate lots and original cost, units and as-of balances remain exact", async () => {
  const h = await holding(),
    bank = (await banks()).a;
  await postAcquisition(acquisition(h, bank.id));
  await postAcquisition(
    acquisition(h, bank.id, {
      amount: "25.15",
      units: "0.123456",
      postingDate: day(2),
    }),
  );
  const d = await holdingDetail(people.owner, h.id);
  expect(d.originalCost).toBe("125.16");
  expect(d.units).toBe("3.123457");
  const lots = await investmentLots(people.owner, h.id);
  expect(lots.total).toBe(2);
  expect(lots.items.map((l) => l.cost).sort()).toEqual(["100.01", "25.15"]);
  expect(
    (await holdings(people.owner, { q: h.body.name, asOf: period.start }))
      .items[0],
  ).toMatchObject({ originalCost: "100.01", carryingValue: "100.01" });
});
it("amount-based holdings reject unit records and unit holdings require positive bounded quantities", async () => {
  const bank = (await banks()).a,
    amount = await holding({ unitMode: "AMOUNT" }),
    d = await postAcquisition(acquisition(amount, bank.id));
  expect(d.item.units).toBeNull();
  expect((await holdingDetail(people.owner, amount.id)).units).toBeNull();
  const bad = await move(
    "CREATE",
    acquisition(amount, bank.id, { units: "1" }),
  );
  await expect(
    move("POST", {
      id: bad.id,
      expectedVersion: 1,
      reason: "Units on amount holding",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_MAPPING" });
  const unit = await holding(),
    missing = await move("CREATE", acquisition(unit, bank.id, { units: null }));
  await expect(
    move("POST", {
      id: missing.id,
      expectedVersion: 1,
      reason: "Missing unit quantity",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_MAPPING" });
  for (const units of ["0", "0.0000001", "100000000000000", 1])
    await expect(
      move("CREATE", acquisition(unit, bank.id, { units })),
    ).rejects.toThrow();
});
it("exact upper-bound paisa and six-decimal units never pass through binary floats", async () => {
  const h = await holding(),
    bank = (await banks()).a,
    d = await postAcquisition(
      acquisition(h, bank.id, {
        amount: "999999999999999999.99",
        units: "99999999999999.999999",
      }),
    );
  expect(d.item.amount).toBe("999999999999999999.99");
  expect((await holdingDetail(people.owner, h.id)).units).toBe(
    "99999999999999.999999",
  );
});
it("permanent post replay and competing retries create exactly one journal, lot and immutable event", async () => {
  const h = await holding(),
    bank = (await banks()).a,
    d = await move("CREATE", acquisition(h, bank.id)),
    b = { id: d.id, expectedVersion: 1, reason: "Retry exact acquisition" },
    key = crypto.randomUUID(),
    r = await Promise.all([move("POST", b, key), move("POST", b, key)]);
  expect(r[0]).toEqual(r[1]);
  expect(
    await db.financeInvestmentLot.count({ where: { movementId: d.id } }),
  ).toBe(1);
  expect(
    await db.financeInvestmentEvent.count({ where: { movementId: d.id } }),
  ).toBe(1);
  await expect(
    db.$executeRaw`UPDATE "FinanceInvestmentLot" SET cost=cost+1 WHERE "movementId"=${d.id}::uuid`,
  ).rejects.toThrow();
  await expect(
    db.$executeRaw`UPDATE "FinanceInvestmentEvent" SET "carryingDelta"=0 WHERE "movementId"=${d.id}::uuid`,
  ).rejects.toThrow();
});
it("dated acquisition reversal posts opposite original legs and retains original lots with zero balances", async () => {
  const h = await holding(),
    bank = (await banks()).a,
    d = await postAcquisition(acquisition(h, bank.id)),
    b = {
      id: d.item.id,
      expectedVersion: 2,
      postingDate: day(1),
      reason: "Reverse synthetic acquisition",
    },
    key = crypto.randomUUID(),
    r = await move("REVERSE", b, key);
  expect(await move("REVERSE", b, key)).toEqual(r);
  expect(await holdingDetail(people.owner, h.id)).toMatchObject({
    originalCost: "0.00",
    carryingValue: "0.00",
    units: "0.000000",
  });
  const lots = await investmentLots(people.owner, h.id);
  expect(lots.total).toBe(1);
  expect(lots.items[0]).toMatchObject({
    cost: "100.01",
    remainingCost: "0.00",
    carryingValue: "0.00",
    remainingUnits: "0.000000",
  });
  expect(
    (await movementDetail(people.owner, r.reversalId!)).item.entry!.lines.map(
      (l) => [l.accountId, l.debit, l.credit],
    ),
  ).toEqual(d.item.entry!.lines.map((l) => [l.accountId, l.credit, l.debit]));
});
it("used policy terms and mappings freeze and an outstanding holding cannot be archived", async () => {
  const h = await holding(),
    bank = (await banks()).a;
  await postAcquisition(acquisition(h, bank.id));
  await expect(
    register("UPDATE", {
      ...h.body,
      id: h.id,
      expectedVersion: 1,
      policy: "Changed after use",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_HOLDING_TERMS_USED" });
  await expect(
    register("ARCHIVE", {
      id: h.id,
      expectedVersion: 1,
      reason: "Hide current holding",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_HOLDING_OUTSTANDING" });
  await expect(
    register("CREATE", { ...h.body, classification: "NONCURRENT" }),
  ).rejects.toMatchObject({ code: "FINANCE_INVESTMENT_MAPPING" });
  await expect(
    register("CREATE", { ...h.body, currency: "USD" }),
  ).rejects.toThrow();
});
it("raw orphan lots cannot attach to draft sources and failed future posting leaves no lot/event", async () => {
  const h = await holding(),
    bank = (await banks()).a,
    d = await move("CREATE", acquisition(h, bank.id));
  await expect(
    db.$executeRaw`INSERT INTO "FinanceInvestmentLot"(id,"holdingId","movementId","acquisitionDate",cost,units) VALUES(${crypto.randomUUID()}::uuid,${h.id}::uuid,${d.id}::uuid,${period.start}::date,100.01,3.000001)`,
  ).rejects.toThrow("FINANCE_SOURCE_MISMATCH");
  const future = await newPeriod(true),
    f = await move(
      "CREATE",
      acquisition(h, bank.id, {
        documentDate: future.start,
        postingDate: future.start,
      }),
    );
  await expect(
    move("POST", {
      id: f.id,
      expectedVersion: 1,
      reason: "Future acquisition",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FUTURE_DATE" });
  expect(
    await db.financeInvestmentLot.count({ where: { movementId: f.id } }),
  ).toBe(0);
  expect(
    await db.financeInvestmentEvent.count({ where: { movementId: f.id } }),
  ).toBe(0);
});
it("private holding and lot reads deny unselected and lower roles before parsing details", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(holdings(people[who], { q: "private" })).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(investmentLots(people[who], "invalid")).rejects.toMatchObject({
      status: 403,
    });
    expect((await holdingRead(req(who))).status).toBe(403);
    expect(
      (
        await holdingMutation(
          req(who, { reauth: { password }, unexpected: true }),
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
  expect((await holdingRead(req())).headers.get("cache-control")).toContain(
    "no-store",
  );
});
it("restricted runtime cannot write lots/events, invoke investment helpers or allocate holding numbers", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    expect(
      (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceInvestmentHolding"','SELECT') AS read,has_table_privilege(current_user,'"FinanceInvestmentLot"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_holding_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_investment_expected(uuid)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_holding_number','USAGE') AS number`,
        )
      ).rows[0],
    ).toEqual({
      read: true,
      write: false,
      command: true,
      helper: false,
      number: false,
    });
  } finally {
    await sql.end();
  }
});
