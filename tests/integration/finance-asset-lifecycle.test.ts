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
  prefix = "A26." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

const { assetCommand, assetDetail } =
  await import("@/modules/finance/assets/service");
async function asset(
  action: Parameters<typeof assetCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return assetCommand(v.actor, v.proof, action, input, key);
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
const { assetMovementCommand } =
  await import("@/modules/finance/assets/lifecycle/service");
async function life(
  action: Parameters<typeof assetMovementCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
) {
  const v = await proof();
  return assetMovementCommand(v.actor, v.proof, action, input, key);
}
beforeAll(async () => {
  const rows = await db.$queryRaw<
    { start: Date }[]
  >`SELECT d::date AS start FROM generate_series(DATE '1800-01-01',DATE '1840-01-01',interval '1 year')d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]')&&daterange(d::date,(d+interval '11 months 30 days')::date,'[]')) ORDER BY d LIMIT 1`;
  const start = rows[0].start.toISOString().slice(0, 10),
    end = start.slice(0, 4) + "-12-31",
    r = await config("PERIOD_CREATE", {
      name: prefix + " lifecycle year",
      startDate: start,
      endDate: end,
      reason: "Explicit isolated synthetic year",
    });
  period = { id: r.id, start, end };
});
const month = (n: number) =>
  period.start.slice(0, 4) + "-" + String(n).padStart(2, "0");
const end = (n: number) =>
  new Date(Date.UTC(Number(period.start.slice(0, 4)), n, 0))
    .toISOString()
    .slice(0, 10);
async function equipment(patch: Record<string, unknown> = {}) {
  const p = await purchase(),
    b = registration(p.line.id, {
      convention: "FULL_MONTH_FROM_FIRST_MONTH",
      firstDepMonth: month(1),
      policyEvidence: "Explicit synthetic full-month policy",
      usefulLifeMonths: 3,
      residualValue: "0.01",
      ...patch,
    }),
    a = await asset("CREATE", b),
    expense = await account({
      type: "OPERATING_EXPENSE",
      normalSide: "DEBIT",
      reportGroup: "OPERATING_EXPENSES",
    }),
    acc = await account({
      controlType: "ACCUMULATED_DEPRECIATION",
      isContra: true,
      normalSide: "CREDIT",
    });
  return { ...p, a, b, expense, acc };
}
const generate = (e: Awaited<ReturnType<typeof equipment>>, n: number) => ({
  assetId: e.a.id,
  month: month(n),
  postingDate: end(n),
  expenseAccountId: e.expense,
  accumulatedAccountId: e.acc,
  evidence: "Reviewed monthly plan",
  approvalEvidence: "Explicit policy and month review",
  reason: "Generate review-only monthly draft",
});
const change = (
  e: Awaited<ReturnType<typeof equipment>>,
  patch: Record<string, unknown> = {},
) => ({
  assetId: e.a.id,
  kind: "IMPAIRMENT",
  postingDate: end(1),
  description: "Reviewed asset lifecycle movement",
  evidence: "Synthetic evidence",
  approvalEvidence: "Explicit accountant review",
  amount: "1.00",
  feeAmount: "0.00",
  expenseAccountId: e.expense,
  reason: "Reviewed asset movement",
  ...patch,
});
async function postLife(d: { id: string; version: number }) {
  return life("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post reviewed asset movement",
  });
}
const position = async (id: string) =>
  (
    await db.$queryRaw<
      {
        cost: string;
        depreciation: string;
        carrying: string;
        disposed: number;
      }[]
    >`SELECT cost::text,depreciation::text,carrying::text,disposed FROM encova_finance_asset_position(${id}::uuid)`
  )[0];
it("generation creates a permanent asset/month draft without a journal, including after void and audited reopen", async () => {
  const e = await equipment(),
    before = await db.financeJournalEntry.count(),
    d = await life("GENERATE", generate(e, 1)),
    again = await life("GENERATE", generate(e, 1));
  expect(d.id).toBe(again.id);
  expect(await db.financeJournalEntry.count()).toBe(before);
  await life("VOID", {
    id: d.id,
    expectedVersion: 1,
    reason: "Void unreviewed month",
  });
  expect((await life("GENERATE", generate(e, 1))).id).toBe(d.id);
  await life("REOPEN", {
    id: d.id,
    expectedVersion: 2,
    reason: "Reopen same permanent month",
  });
  await postLife({ id: d.id, version: 3 });
  expect((await position(e.a.id)).depreciation).toBe("33.33");
});
it("exact monthly floor charges put final paisa in the last month and never fall below residual", async () => {
  const e = await equipment();
  const amounts = [];
  for (const n of [1, 2, 3]) {
    const d = await life("GENERATE", generate(e, n));
    amounts.push(
      (
        await db.financeAssetMovement.findUniqueOrThrow({ where: { id: d.id } })
      ).amount.toFixed(2),
    );
    await postLife(d);
  }
  expect(amounts).toEqual(["33.33", "33.33", "33.34"]);
  expect(await position(e.a.id)).toMatchObject({
    carrying: "0.01",
    depreciation: "100.00",
    disposed: 0,
  });
  await expect(life("GENERATE", generate(e, 4))).rejects.toMatchObject({
    code: "FINANCE_ASSET_MONTH",
  });
});
it("out-of-order and stale monthly drafts are blocked until earlier months are posted and the basis is reviewed", async () => {
  const e = await equipment(),
    jan = await life("GENERATE", generate(e, 1)),
    feb = await life("GENERATE", generate(e, 2));
  await expect(postLife(feb)).rejects.toMatchObject({
    code: "FINANCE_ASSET_MONTH_ORDER",
  });
  await postLife(jan);
  await expect(postLife(feb)).rejects.toMatchObject({
    code: "FINANCE_ASSET_STALE_BASIS",
  });
  const refreshed = await life("REFRESH", {
    id: feb.id,
    expectedVersion: 1,
    reason: "Review new posted basis",
  });
  await postLife(refreshed);
  expect((await position(e.a.id)).depreciation).toBe("66.66");
});
it("pending conventions cannot generate and tiny charges keep audited zero months without fabricated journals", async () => {
  const pending = await equipment({
    convention: "PENDING",
    firstDepMonth: null,
    policyEvidence: null,
  });
  await expect(life("GENERATE", generate(pending, 1))).rejects.toMatchObject({
    code: "FINANCE_ASSET_POLICY",
  });
  const e = await equipment({ residualValue: "100.00", usefulLifeMonths: 3 }),
    before = await db.financeJournalEntry.count();
  for (const n of [1, 2]) {
    const d = await life("GENERATE", generate(e, n)),
      r = await postLife(d);
    expect(r.journalId).toBeNull();
  }
  expect(await db.financeJournalEntry.count()).toBe(before);
  const d = await life("GENERATE", generate(e, 3));
  await postLife(d);
  expect((await position(e.a.id)).depreciation).toBe("0.01");
});
it("disposal clears original cost and all actual accumulated-depreciation accounts and keeps net proceeds/results separate", async () => {
  const e = await equipment();
  await postLife(await life("GENERATE", generate(e, 1)));
  const secondAcc = await account({
    controlType: "ACCUMULATED_DEPRECIATION",
    isContra: true,
    normalSide: "CREDIT",
  });
  await postLife(
    await life("GENERATE", {
      ...generate(e, 2),
      accumulatedAccountId: secondAcc,
    }),
  );
  const gain = await account({
      type: "OTHER_INCOME",
      normalSide: "CREDIT",
      reportGroup: "OTHER_INCOME",
    }),
    loss = await account({
      type: "OTHER_EXPENSE",
      normalSide: "DEBIT",
      reportGroup: "OTHER_EXPENSES",
    }),
    d = await life(
      "CREATE",
      change(e, {
        kind: "DISPOSAL",
        expenseAccountId: null,
        postingDate: end(2),
        description: prefix + " multi-control disposal",
        amount: "20.00",
        feeAmount: "30.00",
        cashAccountId: cash,
        gainAccountId: gain,
        lossAccountId: loss,
        feeAccountId: loss,
      }),
    );
  const r = await postLife(d),
    entry = await db.financeJournalEntry.findUniqueOrThrow({
      where: { id: r.journalId! },
      include: { lines: true },
    });
  expect(
    entry.lines.find((l) => l.accountId === e.fixed)?.credit.toFixed(2),
  ).toBe("100.01");
  expect(entry.lines.find((l) => l.accountId === e.acc)?.debit.toFixed(2)).toBe(
    "33.33",
  );
  expect(
    entry.lines.find((l) => l.accountId === secondAcc)?.debit.toFixed(2),
  ).toBe("33.33");
  const { cashRegister } = await import("@/modules/finance/treasury/service");
  const register = await cashRegister(people.owner, {
    cashAccountId: cash,
    q: prefix + " multi-control disposal",
  });
  expect(register.items).toHaveLength(1);
  expect(register.items[0]).toMatchObject({
    sourceType: "ASSET_MOVEMENT",
    sourceId: d.id,
    debit: "0.00",
    credit: "10.00",
  });
  expect(await position(e.a.id)).toMatchObject({
    cost: "0.00",
    depreciation: "0.00",
    carrying: "0.00",
    disposed: 1,
  });
  expect((await assetDetail(people.owner, e.a.id)).item.state).toBe("DISPOSED");
});
it("dated disposal reversal restores actual cost/depreciation and does not release the original purchase allocation", async () => {
  const e = await equipment();
  await postLife(await life("GENERATE", generate(e, 1)));
  const gain = await account({
      type: "OTHER_INCOME",
      normalSide: "CREDIT",
      reportGroup: "OTHER_INCOME",
    }),
    loss = await account({
      type: "OTHER_EXPENSE",
      normalSide: "DEBIT",
      reportGroup: "OTHER_EXPENSES",
    }),
    d = await life(
      "CREATE",
      change(e, {
        kind: "DISPOSAL",
        expenseAccountId: null,
        amount: "0.00",
        cashAccountId: null,
        gainAccountId: gain,
        lossAccountId: loss,
      }),
    );
  await postLife(d);
  await expect(asset("CREATE", registration(e.line.id))).rejects.toMatchObject({
    code: "FINANCE_ASSET_SOURCE_CAPACITY",
  });
  await life("REVERSE", {
    id: d.id,
    expectedVersion: 2,
    postingDate: end(2),
    reason: "Correct asset disposal",
  });
  expect(await position(e.a.id)).toMatchObject({
    cost: "100.01",
    depreciation: "33.33",
    carrying: "66.68",
    disposed: 0,
  });
});
it("impairment requires prospective policy review; dated policy changes create no journal and replan remaining exact cost", async () => {
  const e = await equipment();
  await postLife(await life("GENERATE", generate(e, 1)));
  await postLife(await life("CREATE", change(e, { amount: "6.68" })));
  await expect(life("GENERATE", generate(e, 2))).rejects.toMatchObject({
    code: "FINANCE_ASSET_POLICY_REVIEW",
  });
  const before = await db.financeJournalEntry.count(),
    policy = await life(
      "CREATE",
      change(e, {
        kind: "POLICY_CHANGE",
        expenseAccountId: null,
        amount: "0.00",
        newResidual: "0.00",
        newLifeMonths: 2,
        newFirstMonth: month(2),
      }),
    );
  await postLife(policy);
  expect(await db.financeJournalEntry.count()).toBe(before);
  for (const n of [2, 3])
    await postLife(await life("GENERATE", generate(e, n)));
  expect((await position(e.a.id)).carrying).toBe("0.00");
});
it("source replay and concurrent post cannot duplicate journals, monthly charges or immutable asset events", async () => {
  const e = await equipment(),
    d = await life("GENERATE", generate(e, 1)),
    b = { id: d.id, expectedVersion: 1, reason: "Same reviewed post" },
    key = crypto.randomUUID(),
    out = await Promise.all([life("POST", b, key), life("POST", b, key)]);
  expect(out[0]).toEqual(out[1]);
  expect(
    await db.financeAssetEvent.count({ where: { movementId: d.id } }),
  ).toBe(1);
  await expect(
    db.$executeRaw`UPDATE "FinanceAssetEvent" SET "depreciationDelta"=0 WHERE "movementId"=${d.id}::uuid`,
  ).rejects.toThrow();
  const audit = await db.financeAuditEvent.findFirstOrThrow({
    where: {
      entityType: "FinanceAssetMovement",
      entityId: d.id,
      action: "FINANCE_ASSET_MOVEMENT_POST",
    },
  });
  const payload = audit.data as {
    source: { amount: unknown; feeAmount: unknown; newResidual: unknown };
  };
  expect(payload.source.amount).toBe("33.33");
  expect(payload.source.feeAmount).toBe("0.00");
  expect(payload.source.newResidual).toBeNull();
});

it("private read models reflect current cost after impairment and reject lower roles without leaking source history", async () => {
  const { assetMovementDetail, assetMovements } =
    await import("@/modules/finance/assets/lifecycle/service");
  const { assetMovementRead, assetMovementMutation } =
    await import("@/modules/finance/assets/lifecycle/http");
  const e = await equipment(),
    d = await life("CREATE", change(e, { amount: "20.00" }));
  await postLife(d);
  expect((await assetDetail(people.owner, e.a.id)).item).toMatchObject({
    cost: "100.01",
    currentCost: "80.01",
    carryingValue: "80.01",
  });
  expect(
    (await assetMovementDetail(people.owner, d.id)).item.event?.costDelta,
  ).toBe("-20.00");
  expect(
    (await assetMovements(people.owner, { assetId: e.a.id })).items,
  ).toHaveLength(1);
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(assetMovementDetail(people[who], d.id)).rejects.toMatchObject({
      status: 403,
    });
    expect((await assetMovementRead(req(who), d.id)).status).toBe(403);
    expect(
      (
        await assetMovementMutation(
          req(who, { reauth: { password }, unexpected: true }),
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
  const r = await assetMovementRead(req(), d.id);
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
});
it("runtime has checked commands and read-only sources, with private helpers, counters and Data API roles denied", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    expect(
      (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceAssetMovement"','SELECT') AS read,has_table_privilege(current_user,'"FinanceAssetMovement"','UPDATE') AS write,has_table_privilege(current_user,'"FinanceAssetEvent"','INSERT') AS event,has_function_privilege(current_user,'encova_finance_asset_movement_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_asset_capture(uuid)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_asset_movement_number','USAGE') AS number`,
        )
      ).rows[0],
    ).toEqual({
      read: true,
      write: false,
      event: false,
      command: true,
      helper: false,
      number: false,
    });
    await sql.query("RESET ROLE");
    for (const role of ["anon", "authenticated"]) {
      expect(
        (
          await sql.query(
            `SELECT has_table_privilege($1,'"FinanceAssetEvent"','SELECT') AS read,has_function_privilege($1,'encova_finance_asset_movement_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command`,
            [role],
          )
        ).rows[0],
      ).toEqual({ read: false, command: false });
    }
  } finally {
    await sql.end();
  }
});
it("used initial policy and monetary caches are protected while asset location edits remain possible", async () => {
  const e = await equipment(),
    d = await life("GENERATE", generate(e, 1));
  await postLife(d);
  const detail = (await assetDetail(people.owner, e.a.id)).item;
  const { billLineId, fundingMovementId, cost, ...body } = e.b;
  void billLineId;
  void fundingMovementId;
  void cost;
  await expect(
    asset("UPDATE", {
      ...body,
      id: e.a.id,
      expectedVersion: detail.version,
      residualValue: "2.00",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_POLICY_USED" });
  await asset("UPDATE", {
    ...body,
    id: e.a.id,
    expectedVersion: detail.version,
    location: "Reviewed new custody location",
  });
  expect((await assetDetail(people.owner, e.a.id)).item.location).toBe(
    "Reviewed new custody location",
  );
  await expect(
    db.$executeRaw`UPDATE "FinanceAsset" SET "accumulatedDepreciation"=0,version=version+1 WHERE id=${e.a.id}::uuid`,
  ).rejects.toThrow(/FINANCE_ASSET_EVENT_MISMATCH/);
  await expect(
    db.$executeRaw`UPDATE "FinanceAssetEvent" SET "depreciationDelta"=0 WHERE "movementId"=${d.id}::uuid`,
  ).rejects.toThrow();
});
it("draft mapping and posting date can be corrected on the same permanent monthly source", async () => {
  const e = await equipment(),
    d = await life("GENERATE", {
      ...generate(e, 1),
      accumulatedAccountId: e.expense,
      postingDate: period.start,
    });
  await expect(postLife(d)).rejects.toMatchObject({
    code: "FINANCE_ASSET_MONTH",
  });
  const detail = await db.financeAssetMovement.findUniqueOrThrow({
    where: { id: d.id },
  });
  const updated = await life("UPDATE", {
    id: d.id,
    expectedVersion: 1,
    postingDate: end(1),
    description: detail.description,
    evidence: detail.evidence,
    approvalEvidence: detail.approvalEvidence,
    amount: "0.00",
    expenseAccountId: e.expense,
    accumulatedAccountId: e.acc,
    reason: "Correct month date and protected mapping",
  });
  expect(updated.id).toBe(d.id);
  await postLife(updated);
  expect((await position(e.a.id)).depreciation).toBe("33.33");
});
it("over-impairment, invalid control mappings and negative-history reversals roll back without consuming drafts", async () => {
  const e = await equipment(),
    tooMuch = await life("CREATE", change(e, { amount: "100.02" }));
  await expect(postLife(tooMuch)).rejects.toMatchObject({
    code: "FINANCE_ASSET_CAPACITY",
  });
  const wrong = await life("CREATE", change(e, { expenseAccountId: e.acc }));
  await expect(postLife(wrong)).rejects.toMatchObject({
    code: "FINANCE_ASSET_MAPPING",
  });
  const increase = await life(
    "CREATE",
    change(e, {
      kind: "ADJUSTMENT_INCREASE",
      expenseAccountId: null,
      counterAccountId: revenue,
      amount: "10.00",
    }),
  );
  await postLife(increase);
  const consume = await life("CREATE", change(e, { amount: "110.01" }));
  await postLife(consume);
  await expect(
    life("REVERSE", {
      id: increase.id,
      expectedVersion: 2,
      postingDate: end(1),
      reason: "Refuse reversing already consumed basis",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_CAPACITY" });
  expect((await position(e.a.id)).carrying).toBe("0.00");
});
it("future and closed periods reject monetary and register-only asset postings", async () => {
  const e = await equipment();
  const rows = await db.$queryRaw<
    { day: Date }[]
  >`SELECT d::date AS day FROM generate_series(DATE '1850-01-01',DATE '1899-01-01',interval '1 year')d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND d::date BETWEEN p."startDate" AND p."endDate") ORDER BY d LIMIT 1`;
  const day = rows[0].day;
  // Explicit closed fixture inserted by isolated database operator; close/reopen workflows belong to F39.
  await db.financePeriod.create({
    data: {
      name: prefix + " closed lifecycle fixture",
      startDate: day,
      endDate: day,
      state: "CLOSED",
      closedAt: new Date(),
      closedById: people.owner.id,
    },
  });
  const dt = day.toISOString().slice(0, 10),
    d = await life("CREATE", change(e, { postingDate: dt })),
    policy = await life(
      "CREATE",
      change(e, {
        kind: "POLICY_CHANGE",
        postingDate: dt,
        amount: "0.00",
        expenseAccountId: null,
        newResidual: "0.00",
        newLifeMonths: 2,
        newFirstMonth: dt.slice(0, 7),
      }),
    );
  await expect(postLife(d)).rejects.toMatchObject({
    code: "FINANCE_PERIOD_UNAVAILABLE",
  });
  await expect(postLife(policy)).rejects.toMatchObject({
    code: "FINANCE_PERIOD_UNAVAILABLE",
  });
  if (
    !(await db.financePeriod.findFirst({
      where: {
        state: { not: "VOID" },
        startDate: { lte: new Date("9999-12-31") },
        endDate: { gte: new Date("9999-12-31") },
      },
    }))
  )
    await config("PERIOD_CREATE", {
      name: prefix + " explicit far-future fixture",
      startDate: "9999-12-31",
      endDate: "9999-12-31",
      reason: "Exercise future-date guard independently of missing periods",
    });
  const future = await life("CREATE", change(e, { postingDate: "9999-12-31" }));
  await expect(postLife(future)).rejects.toMatchObject({
    code: "FINANCE_FUTURE_DATE",
  });
});

it("unposted future month identities survive prospective policy review and refresh to the new charge", async () => {
  const e = await equipment(),
    future = await life("GENERATE", generate(e, 2));
  const impairment = await life("CREATE", change(e, { amount: "10.01" }));
  await postLife(impairment);
  const policy = await life(
    "CREATE",
    change(e, {
      kind: "POLICY_CHANGE",
      expenseAccountId: null,
      amount: "0.00",
      newResidual: "0.00",
      newLifeMonths: 2,
      newFirstMonth: month(2),
    }),
  );
  await postLife(policy);
  await expect(postLife(future)).rejects.toMatchObject({
    code: "FINANCE_ASSET_STALE_BASIS",
  });
  const refreshed = await life("REFRESH", {
    id: future.id,
    expectedVersion: 1,
    reason: "Review same month under revised plan",
  });
  await postLife(refreshed);
  expect((await position(e.a.id)).carrying).toBe("45.00");
  expect((await life("GENERATE", generate(e, 2))).id).toBe(future.id);
});

it("unused policy reversal creates only a dated event while consumed policy cannot be reversed", async () => {
  const e = await equipment(),
    body = change(e, {
      kind: "POLICY_CHANGE",
      amount: "0.00",
      expenseAccountId: null,
      newResidual: "0.01",
      newLifeMonths: 2,
      newFirstMonth: month(2),
    }),
    policy = await life("CREATE", body),
    posted = await postLife(policy);
  expect(posted.journalId).toBeNull();
  const correction = await life("REVERSE", {
    id: policy.id,
    expectedVersion: 2,
    postingDate: end(1),
    reason: "Correct unused prospective policy",
  });
  expect(correction.journalId).toBeNull();
  const replacement = await life("CREATE", body);
  await postLife(replacement);
  await postLife(await life("GENERATE", generate(e, 2)));
  await expect(
    life("REVERSE", {
      id: replacement.id,
      expectedVersion: 2,
      postingDate: end(2),
      reason: "Refuse reversing policy already consumed by a charge",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ASSET_POLICY_USED" });
});
