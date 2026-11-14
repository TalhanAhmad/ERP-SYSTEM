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
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "A25." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

const { assetCommand, assetDetail, assets, assetOptions } =
  await import("@/modules/finance/assets/service");
const { assetRead, assetMutation } =
  await import("@/modules/finance/assets/http");
const { movementCommand, movementDetail } =
  await import("@/modules/finance/treasury/service");
const { supplierCommand } =
  await import("@/modules/finance/payables/supplier/service");
async function asset(
  action: Parameters<typeof assetCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return assetCommand(v.actor, v.proof, action, input, key);
}
async function move(
  action: Parameters<typeof movementCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return movementCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function supplier(action: "CREATE" | "POST", input: unknown) {
  const v = await proof();
  return supplierCommand(
    v.actor,
    v.proof,
    "SUPPLIER_CREDIT",
    action,
    input,
    crypto.randomUUID(),
  );
}
async function purchase(patch: Record<string, unknown> = {}) {
  const fixed = await account({ controlType: "FIXED_ASSET" }),
    bill = await posted({
      lines: [
        line({
          treatment: "ASSET",
          costAccountId: fixed,
          unitRate: "100.01",
          ...patch,
        }),
      ],
    });
  return { fixed, bill, line: bill.item.lines[0] };
}
function registration(
  billLineId: string | null,
  patch: Record<string, unknown> = {},
) {
  return {
    tag: prefix + "." + ++count,
    description: "Synthetic laptop",
    location: "Synthetic office",
    custodianId: null,
    billLineId,
    fundingMovementId: null,
    cost: "100.01",
    inServiceDate: period.start,
    usefulLifeMonths: 36,
    residualValue: "0.00",
    depreciationMethod: "STRAIGHT_LINE",
    convention: "PENDING",
    firstDepMonth: null,
    policyEvidence: null,
    reason: "Register posted equipment",
    ...patch,
  };
}
function metadata(b: ReturnType<typeof registration>) {
  const { billLineId, fundingMovementId, cost, ...rest } = b;
  void billLineId;
  void fundingMovementId;
  void cost;
  return rest;
}
async function funded(kind = "FOUNDER_OUTLAY", amount = "100.01") {
  const fixed = await account({ controlType: "FIXED_ASSET" }),
    control = await account({
      type: kind === "FOUNDER_OUTLAY" ? "LIABILITY" : "EQUITY",
      normalSide: "CREDIT",
      reportGroup: kind === "FOUNDER_OUTLAY" ? "CURRENT_LIABILITIES" : "EQUITY",
      controlType: kind === "FOUNDER_OUTLAY" ? "FOUNDER_PAYABLE" : "CAPITAL",
    }),
    p = await party({ kind: "OTHER" }),
    d = await move("CREATE", {
      kind,
      partyId: p,
      controlAccountId: control,
      counterAccountId: fixed,
      amount,
      reference: prefix + " funding " + ++count,
      documentDate: period.start,
      postingDate: period.start,
      description: "Founder-funded equipment",
      evidence: "Reviewed company asset evidence",
      approvalEvidence:
        kind === "NONCASH_CAPITAL" ? "Reviewed noncash value" : null,
      reason: "Reviewed synthetic funding",
    });
  await move("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post company asset source",
  });
  return { fixed, id: d.id };
}
it("registration links a posted fixed-asset purchase and adds no second journal, with pending convention explicit", async () => {
  const p = await purchase(),
    before = await db.financeJournalEntry.count(),
    r = await asset("CREATE", registration(p.line.id)),
    d = await assetDetail(people.owner, r.id);
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect(d.item).toMatchObject({
    cost: "100.01",
    accumulatedDepreciation: "0.00",
    carryingValue: "100.01",
    convention: "PENDING",
    firstDepMonth: null,
    accountId: p.fixed,
  });
  expect(d.item.sourceSnapshot).toHaveProperty("number", p.bill.item.number);
  expect(d.history[0].action).toBe("FINANCE_ASSET_CREATE");
});
it("cumulative source allocations and competing creations cannot exceed remaining net purchase cost", async () => {
  const p = await purchase();
  await asset("CREATE", registration(p.line.id, { cost: "60.00" }));
  await asset("CREATE", registration(p.line.id, { cost: "40.01" }));
  await expect(
    asset("CREATE", registration(p.line.id, { cost: "0.01" })),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_SOURCE_CAPACITY" });
  const other = await purchase(),
    results = await Promise.allSettled([
      asset("CREATE", registration(other.line.id, { cost: "60.00" })),
      asset("CREATE", registration(other.line.id, { cost: "60.00" })),
    ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("recoverable input tax is excluded from asset basis and tax evidence remains linked to the purchase", async () => {
  const { taxCommand } = await import("@/modules/finance/taxes/service"),
    input = await account({ controlType: "TAX_INPUT" }),
    output = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "TAX_OUTPUT",
    }),
    v = await proof(),
    tax = await taxCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        code: prefix + ".TAX." + ++count,
        name: "Synthetic tax only",
        kind: "INDIRECT",
        effectiveFrom: period.start,
        effectiveTo: period.end,
        rate: "10",
        mode: "EXCLUSIVE",
        rounding: "HALF_UP",
        inputAccountId: input,
        outputAccountId: output,
        policyEvidence: "Synthetic explicit tax policy",
        reason: "Test recoverable source tax",
      },
      crypto.randomUUID(),
    ),
    p = await purchase({ unitRate: "100.00", taxCodeId: tax.id });
  expect(p.bill.item.totalAmount).toBe("110.00");
  const r = await asset("CREATE", registration(p.line.id, { cost: "100.00" }));
  expect(
    (await assetDetail(people.owner, r.id)).item.sourceSnapshot,
  ).toHaveProperty("recoverableTax", "10.00");
  await expect(
    asset("CREATE", registration(p.line.id, { cost: "0.01" })),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_SOURCE_CAPACITY" });
});
it("later supplier credit cannot reduce linked asset basis until an unused registration is voided", async () => {
  const p = await purchase(),
    r = await asset("CREATE", registration(p.line.id)),
    advance = await account({ controlType: "SUPPLIER_ADVANCE" }),
    credit = await supplier("CREATE", {
      reference: prefix + " credit " + ++count,
      partyId: client,
      billId: p.bill.item.id,
      advanceAccountId: advance,
      documentDate: period.start,
      postingDate: period.start,
      description: "Supplier asset credit",
      evidence: "Reviewed supplier credit",
      creditLines: [{ billLineId: p.line.id, amount: "10.00" }],
      reason: "Credit purchased equipment",
    });
  await expect(
    supplier("POST", {
      id: credit.id,
      expectedVersion: 1,
      reason: "Would overstate linked basis",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_SOURCE_CAPACITY" });
  expect((await billDetail(people.owner, p.bill.item.id)).payableBalance).toBe(
    "100.01",
  );
  const before = await db.financeJournalEntry.count();
  await asset("VOID", {
    id: r.id,
    expectedVersion: 1,
    reason: "Correct unused registration",
  });
  expect(await db.financeJournalEntry.count()).toBe(before);
  await supplier("POST", {
    id: credit.id,
    expectedVersion: 1,
    reason: "Post credit after source release",
  });
  await expect(asset("CREATE", registration(p.line.id))).rejects.toMatchObject({
    code: "FINANCE_ASSET_SOURCE_CAPACITY",
  });
  expect(
    (
      await assetOptions(people.owner, {
        kind: "BILL_LINE",
        q: p.bill.item.number,
      })
    ).items[0].name,
  ).toContain("90.01");
});
it("founder-funded assets link original posted cost and reversal is blocked while a registration uses it", async () => {
  const p = await funded(),
    r = await asset("CREATE", registration(null, { fundingMovementId: p.id }));
  expect((await assetDetail(people.owner, r.id)).item.accountId).toBe(p.fixed);
  await expect(
    move("REVERSE", {
      id: p.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Cannot remove linked purchase",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_SOURCE_CAPACITY" });
  await asset("VOID", {
    id: r.id,
    expectedVersion: 1,
    reason: "Release unused asset allocation",
  });
  await move("REVERSE", {
    id: p.id,
    expectedVersion: 2,
    postingDate: period.start,
    reason: "Reverse unused funded purchase",
  });
  expect((await movementDetail(people.owner, p.id)).item.state).toBe(
    "REVERSED",
  );
});
it("noncash capital source retains exact upper-bound paisa without a new recognition", async () => {
  const p = await funded("NONCASH_CAPITAL", "999999999999999999.99"),
    before = await db.financeJournalEntry.count(),
    r = await asset(
      "CREATE",
      registration(null, {
        fundingMovementId: p.id,
        cost: "999999999999999999.99",
        residualValue: "0.01",
      }),
    );
  expect((await assetDetail(people.owner, r.id)).item.cost).toBe(
    "999999999999999999.99",
  );
  expect(await db.financeJournalEntry.count()).toBe(before);
});
it("metadata edits are versioned, source/cost are immutable and convention needs evidence and valid first month", async () => {
  const p = await purchase(),
    b = registration(p.line.id),
    r = await asset("CREATE", b),
    m = metadata(b);
  await asset("UPDATE", {
    ...m,
    id: r.id,
    expectedVersion: 1,
    location: "Reviewed new room",
    convention: "FULL_MONTH_FROM_FIRST_MONTH",
    firstDepMonth: period.start.slice(0, 7),
    policyEvidence: "Explicit synthetic company approval",
  });
  expect((await assetDetail(people.owner, r.id)).item.version).toBe(2);
  await expect(
    asset("UPDATE", { ...m, id: r.id, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await expect(
    asset("UPDATE", { ...m, id: r.id, expectedVersion: 2, cost: "1.00" }),
  ).rejects.toThrow();
  await expect(
    db.$executeRaw`UPDATE "FinanceAsset" SET cost=1,version=version+1 WHERE id=${r.id}::uuid`,
  ).rejects.toThrow("FINANCE_ASSET_IMMUTABLE");
  await expect(
    db.$executeRaw`UPDATE "FinanceAsset" SET "accumulatedDepreciation"=1,version=version+1 WHERE id=${r.id}::uuid`,
  ).rejects.toThrow();
});
it("drafts, operating expenses, dual sources and inactive new custodians cannot be registered as equipment", async () => {
  const draft = await command("CREATE", body()),
    d = await billDetail(people.owner, draft.id),
    expense = await posted();
  for (const id of [d.item.lines[0].id, expense.item.lines[0].id])
    await expect(asset("CREATE", registration(id))).rejects.toMatchObject({
      code: "FINANCE_ASSET_SOURCE",
    });
  const p = await purchase();
  await expect(
    asset(
      "CREATE",
      registration(p.line.id, { fundingMovementId: crypto.randomUUID() }),
    ),
  ).rejects.toThrow();
  await expect(
    asset(
      "CREATE",
      registration(p.line.id, { custodianId: crypto.randomUUID() }),
    ),
  ).rejects.toThrow();
});
it("permanent register retries return one asset and void preserves history while releasing an active tag", async () => {
  const p = await purchase(),
    b = registration(p.line.id),
    key = crypto.randomUUID(),
    r = await asset("CREATE", b, key);
  expect(await asset("CREATE", b, key)).toEqual(r);
  expect(
    await db.financeAsset.count({ where: { billLineId: p.line.id } }),
  ).toBe(1);
  await expect(
    asset("CREATE", { ...b, description: "Changed retry" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  await asset("VOID", {
    id: r.id,
    expectedVersion: 1,
    reason: "Correct unused registration",
  });
  const second = await asset("CREATE", b);
  expect(second.id).not.toBe(r.id);
  expect((await assetDetail(people.owner, r.id)).item.state).toBe("VOIDED");
  expect((await assets(people.owner, { q: b.tag, state: "ALL" })).total).toBe(
    2,
  );
});
it("lower roles and unselected roots cannot see source costs, custodians or asset details", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(assets(people[who], { q: "private" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      assetOptions(people[who], { kind: "BILL_LINE" }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await assetRead(req(who))).status).toBe(403);
    expect(
      (
        await assetMutation(
          req(who, { reauth: { password }, unexpected: true }),
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
  expect((await assetRead(req())).headers.get("cache-control")).toContain(
    "no-store",
  );
});
it("runtime can read and execute only checked registration, not raw assets, source helpers or numbers", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    expect(
      (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceAsset"','SELECT') AS read,has_table_privilege(current_user,'"FinanceAsset"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_asset_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_asset_source(uuid,uuid)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_asset_number','USAGE') AS number`,
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

it("an already-paid expense asset line is eligible without a second cash or AP posting", async () => {
  const fixed = await account({ controlType: "FIXED_ASSET" }),
    b = await posted({
      kind: "EXPENSE",
      payableAccountId: null,
      cashAccountId: cash,
      lines: [
        line({ treatment: "ASSET", costAccountId: fixed, unitRate: "100.01" }),
      ],
    }),
    before = await db.financeJournalEntry.count(),
    r = await asset("CREATE", registration(b.item.lines[0].id));
  expect(
    (await assetDetail(people.owner, r.id)).item.billLine?.bill.number,
  ).toBe(b.item.number);
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect((await billDetail(people.owner, b.item.id)).payableBalance).toBe(
    "0.00",
  );
});
it("the confirmed first depreciation month cannot precede source ledger recognition even for earlier physical service", async () => {
  const fixed = await account({ controlType: "FIXED_ASSET" }),
    dt = new Date(period.start);
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  const earlier = dt.toISOString().slice(0, 10),
    b = await posted({
      billDate: earlier,
      lines: [
        line({ treatment: "ASSET", costAccountId: fixed, unitRate: "100.01" }),
      ],
    });
  await expect(
    asset(
      "CREATE",
      registration(b.item.lines[0].id, {
        inServiceDate: earlier,
        convention: "FULL_MONTH_FROM_FIRST_MONTH",
        firstDepMonth: earlier.slice(0, 7),
        policyEvidence: "Explicit month review",
      }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_POLICY" });
  const r = await asset(
    "CREATE",
    registration(b.item.lines[0].id, {
      inServiceDate: earlier,
      convention: "FULL_MONTH_FROM_FIRST_MONTH",
      firstDepMonth: period.start.slice(0, 7),
      policyEvidence: "Explicit month review",
    }),
  );
  expect(
    (await assetDetail(people.owner, r.id)).item.accumulatedDepreciation,
  ).toBe("0.00");
});
it("source and custodian options are bounded and custody stays private when an employee later becomes inactive", async () => {
  const p = await purchase(),
    r = await asset(
      "CREATE",
      registration(p.line.id, { custodianId: people.member.id }),
    );
  expect((await assetDetail(people.owner, r.id)).item.custodian?.username).toBe(
    people.member.username,
  );
  expect(
    (await assetOptions(people.owner, { kind: "CUSTODIAN" })).items.length,
  ).toBeLessThanOrEqual(25);
  await db.person.update({
    where: { id: people.member.id },
    data: { status: "INACTIVE" },
  });
  const old = await assetDetail(people.owner, r.id);
  expect(old.item.custodian?.username).toBe(people.member.username);
  const b = registration(p.line.id);
  await asset("UPDATE", {
    ...metadata(b),
    custodianId: people.member.id,
    id: r.id,
    expectedVersion: 1,
    location: "Reviewed custody history",
  });
});
