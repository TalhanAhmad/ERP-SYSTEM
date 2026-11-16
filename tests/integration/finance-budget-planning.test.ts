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
  prefix = "BP29." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0,
  client: string,
  period: { id: string; start: string; end: string };
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
const partyBody = (patch: Record<string, unknown> = {}) => ({
  name: prefix + " client " + ++count,
  legalName: prefix + " Synthetic Legal Co",
  kind: "CLIENT",
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
  client = await party();
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

const {
  planningCommand,
  budgetDetail,
  budgets,
  budgetVariance,
  forecastDetail,
  forecasts,
  planningOptions,
} = await import("@/modules/finance/planning/service");
const { billCommand, billDetail } =
  await import("@/modules/finance/payables/service");
async function bill(action: Parameters<typeof billCommand>[2], body: unknown) {
  const v = await proof();
  return billCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function plan(
  action: Parameters<typeof planningCommand>[2],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return planningCommand(v.actor, v.proof, action, body, key);
}
async function project() {
  return db.project.create({
    data: {
      name: prefix + " project " + ++count,
      description: "Ordinary work",
      managerId: people.lead.id,
      members: { create: { userId: people.lead.id } },
    },
  });
}
async function source(amount = "120.00", projectId: string | null = null) {
  const supplier = await party({ kind: "SUPPLIER" }),
    expense = await account({
      type: "DIRECT_COST",
      normalSide: "DEBIT",
      reportGroup: "DIRECT_COSTS",
    }),
    ap = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "PAYABLES",
    }),
    d = await bill("CREATE", {
      kind: "BILL",
      reference: prefix + " cost " + ++count,
      partyId: supplier,
      payableAccountId: ap,
      billDate: period.start,
      postingDate: period.start,
      dueDate: period.end,
      description: prefix + " incurred cost",
      evidence: "Actual synthetic supplier source",
      lines: [
        {
          description: prefix + " original expense",
          quantity: "1",
          unitRate: amount,
          treatment: "EXPENSE",
          costAccountId: expense,
          projectId,
        },
      ],
      reason: "Recognize cost before cash payment",
    });
  await bill("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post incurred cost",
  });
  const b = await billDetail(people.owner, d.id),
    l = await db.financeJournalLine.findFirstOrThrow({
      where: {
        billLineId: b.item.lines[0].id,
        accountId: expense,
        debit: { gt: 0 },
      },
    });
  return { supplier, expense, ap, b, line: l };
}
const budgetBody = (
  projectId: string | null,
  accountId: string,
  patch: Record<string, unknown> = {},
) => ({
  month: period.start.slice(0, 7),
  projectId,
  description: prefix + " expense budget",
  evidence: "Reviewed month and scope plan",
  lines: [{ accountId, amount: "100.00" }],
  reason: "Plan incurred expense scope",
  ...patch,
});
const expense = () =>
  account({
    type: "DIRECT_COST",
    normalSide: "DEBIT",
    reportGroup: "DIRECT_COSTS",
  });
const approve = (
  b: { id: string; version: number },
  key = crypto.randomUUID(),
) =>
  plan(
    "BUDGET_APPROVE",
    {
      id: b.id,
      expectedVersion: b.version,
      approvalEvidence: "Explicit approved cost plan",
      reason: "Approve reviewed monthly budget",
    },
    key,
  );
const forecastBody = (
  projectId: string | null,
  patch: Record<string, unknown> = {},
) => ({
  kind: "RECEIPT",
  expectedDate: "9999-12-31",
  amount: "100.01",
  projectId,
  partyId: client,
  likelihood: "LIKELY",
  likelihoodNote: "Expected under reviewed customer plan",
  description: prefix + " expected receipt",
  evidence: "Future cash planning evidence",
  reason: "Plan expected cash only",
  ...patch,
});
it("approved budget revisions freeze their exact prior plan and never post GL", async () => {
  const p = await project(),
    a = await expense(),
    before = await db.financeJournalEntry.count(),
    one = await plan("BUDGET_CREATE", budgetBody(p.id, a));
  await approve(one);
  const original = await budgetDetail(people.owner, one.id),
    two = await plan(
      "BUDGET_CREATE",
      budgetBody(p.id, a, {
        previousId: one.id,
        previousVersion: 2,
        lines: [{ accountId: a, amount: "120.03" }],
      }),
    );
  expect((await budgetDetail(people.owner, one.id)).item.state).toBe(
    "APPROVED",
  );
  await approve(two);
  const old = await budgetDetail(people.owner, one.id),
    current = await budgetDetail(people.owner, two.id);
  expect(old.item).toMatchObject({
    state: "SUPERSEDED",
    revision: 1,
    total: "100.00",
    snapshot: original.item.snapshot,
  });
  expect(current.item).toMatchObject({
    state: "APPROVED",
    revision: 2,
    total: "120.03",
    previousId: one.id,
  });
  await expect(
    plan("BUDGET_UPDATE", {
      id: one.id,
      expectedVersion: 3,
      description: "Change retained prior budget",
      evidence: "No rewrite",
      lines: [{ accountId: a, amount: "1.00" }],
      reason: "Cannot edit approved history",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PLAN_IMMUTABLE" });
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect(
    old.history.some((e) => e.action === "FINANCE_BUDGET_SUPERSEDED"),
  ).toBe(true);
});
it("voiding a replacement keeps the current approval and the next revision does not reuse its number", async () => {
  const p = await project(),
    a = await expense(),
    one = await plan("BUDGET_CREATE", budgetBody(p.id, a));
  await approve(one);
  const two = await plan(
    "BUDGET_CREATE",
    budgetBody(p.id, a, { previousId: one.id, previousVersion: 2 }),
  );
  await plan("BUDGET_VOID", {
    id: two.id,
    expectedVersion: 1,
    reason: "Retain abandoned budget revision",
  });
  const three = await plan(
    "BUDGET_CREATE",
    budgetBody(p.id, a, { previousId: one.id, previousVersion: 2 }),
  );
  expect((await budgetDetail(people.owner, three.id)).item.revision).toBe(3);
  expect((await budgetDetail(people.owner, one.id)).item.state).toBe(
    "APPROVED",
  );
  await expect(
    db.financeBudget.delete({ where: { id: two.id } }),
  ).rejects.toThrow(/FINANCE_PLAN_RETAINED/);
});
it("one scope has one draft; concurrent repeated approval emits one retained result", async () => {
  const p = await project(),
    a = await expense(),
    r = await Promise.allSettled([
      plan("BUDGET_CREATE", budgetBody(p.id, a)),
      plan("BUDGET_CREATE", budgetBody(p.id, a)),
    ]);
  expect(r.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  const one = (
      r.find((v) => v.status === "fulfilled") as PromiseFulfilledResult<{
        id: string;
        version: number;
      }>
    ).value,
    key = crypto.randomUUID(),
    results = await Promise.all([approve(one, key), approve(one, key)]);
  expect(results[0]).toEqual(results[1]);
  expect(
    await db.financeBudget.count({
      where: { projectId: p.id, state: "APPROVED" },
    }),
  ).toBe(1);
});
it("maximum exact plan precision, future months and zero-cost budgets are nonposting", async () => {
  const p = await project(),
    a = await expense(),
    before = await db.financeJournalEntry.count(),
    d = await plan(
      "BUDGET_CREATE",
      budgetBody(p.id, a, {
        month: "9999-12",
        lines: [{ accountId: a, amount: "999999999999999999.99" }],
      }),
    );
  await approve(d);
  const r = await budgetVariance(people.owner, {
    month: "9999-12",
    projectId: p.id,
  });
  expect(r.totals).toEqual({
    budget: "999999999999999999.99",
    actual: "0.00",
    remaining: "999999999999999999.99",
  });
  expect(await db.financeJournalEntry.count()).toBe(before);
  const p2 = await project(),
    b = await expense();
  await expect(
    plan(
      "BUDGET_CREATE",
      budgetBody(p2.id, a, {
        lines: [
          { accountId: a, amount: "999999999999999999.99" },
          { accountId: b, amount: "0.01" },
        ],
      }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_BUDGET_TOTAL" });
  const zero = await plan(
    "BUDGET_CREATE",
    budgetBody(p2.id, a, { lines: [{ accountId: a, amount: "0.00" }] }),
  );
  await approve(zero);
  expect((await budgetDetail(people.owner, zero.id)).item.total).toBe("0.00");
});
it("budgets accept ordinary expense accounts only and reject duplicate accounts", async () => {
  const p = await project(),
    a = await expense(),
    control = await account({ controlType: "CASH" });
  await expect(
    plan("BUDGET_CREATE", budgetBody(p.id, control)),
  ).rejects.toMatchObject({ code: "FINANCE_BUDGET_MAPPING" });
  await expect(
    plan(
      "BUDGET_CREATE",
      budgetBody(p.id, a, {
        lines: [
          { accountId: a, amount: "1.00" },
          { accountId: a, amount: "2.00" },
        ],
      }),
    ),
  ).rejects.toThrow();
  expect(
    (
      await planningOptions(people.owner, { kind: "BUDGET_ACCOUNT", q: prefix })
    ).items.some((v) => v.id === control),
  ).toBe(false);
});
it("unpaid costs remain actual incurred expense above advisory budget; unbudgeted accounts stay visible", async () => {
  const p = await project(),
    a = await expense(),
    d = await plan("BUDGET_CREATE", budgetBody(p.id, a));
  await approve(d);
  const s = await source("120.00", p.id),
    r = await budgetVariance(people.owner, {
      month: period.start.slice(0, 7),
      projectId: p.id,
    });
  expect(r.totals).toEqual({
    budget: "100.00",
    actual: "120.00",
    remaining: "-20.00",
  });
  expect(r.items.find((v) => v.accountId === s.expense)).toMatchObject({
    budget: "0.00",
    actual: "120.00",
    unbudgeted: true,
    exceeded: true,
  });
  expect(r.advisoryOnly).toBe(true);
  expect((await billDetail(people.owner, s.b.item.id)).payableBalance).toBe(
    "120.00",
  );
});
it("exact reclassification enters the target budget basis once and archived project plans remain available", async () => {
  const { costAllocationCommand, costSourceDetail } =
    await import("@/modules/finance/projects/costs/service");
  const p = await project(),
    s = await source(),
    d = await plan("BUDGET_CREATE", budgetBody(p.id, s.expense));
  await approve(d);
  expect(
    (
      await budgetVariance(people.owner, {
        month: period.start.slice(0, 7),
        projectId: p.id,
      })
    ).totals.actual,
  ).toBe("0.00");
  const basis = await costSourceDetail(people.owner, s.line.id),
    v = await proof(),
    c = await costAllocationCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        sourceLineId: s.line.id,
        postingDate: period.start,
        description: "Assign incurred budget basis",
        evidence: "Approved actual project allocation",
        basisHash: basis.basisHash,
        targets: [{ projectId: p.id, amount: "120.00" }],
        reason: "Apply exact dimension split",
      },
      crypto.randomUUID(),
    ),
    w = await proof();
  await costAllocationCommand(
    w.actor,
    w.proof,
    "POST",
    { id: c.id, expectedVersion: 1, reason: "Post actual dimension split" },
    crypto.randomUUID(),
  );
  await db.project.update({
    where: { id: p.id },
    data: { archivedAt: new Date() },
  });
  const r = await budgetVariance(people.owner, {
    month: period.start.slice(0, 7),
    projectId: p.id,
  });
  expect(r.totals).toEqual({
    budget: "100.00",
    actual: "120.00",
    remaining: "-20.00",
  });
  expect(r.items).toHaveLength(1);
  expect(r.items[0].unbudgeted).toBe(false);
});
it("future forecasts keep separate dates/likelihood and auditable cancellation/reopening without cash or GL", async () => {
  const p = await project(),
    before = await db.financeJournalEntry.count(),
    f = await plan("FORECAST_CREATE", forecastBody(p.id));
  const changed = await plan("FORECAST_UPDATE", {
    id: f.id,
    expectedVersion: 1,
    ...forecastBody(p.id, {
      amount: "999999999999999999.99",
      kind: "PAYMENT",
      likelihood: "POSSIBLE",
      likelihoodNote: "Funding still uncertain",
    }),
  });
  await plan("FORECAST_CANCEL", {
    id: f.id,
    expectedVersion: changed.version,
    reason: "Retain cancelled forecast",
  });
  await expect(
    plan("FORECAST_UPDATE", {
      id: f.id,
      expectedVersion: 3,
      ...forecastBody(p.id),
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PLAN_IMMUTABLE" });
  await plan("FORECAST_REOPEN", {
    id: f.id,
    expectedVersion: 3,
    reason: "Review expected cash again",
  });
  const detail = await forecastDetail(people.owner, f.id);
  expect(detail.item).toMatchObject({
    expectedDate: "9999-12-31",
    amount: "999999999999999999.99",
    kind: "PAYMENT",
    state: "ACTIVE",
    version: 4,
  });
  expect(detail.history).toHaveLength(4);
  expect(await db.financeJournalEntry.count()).toBe(before);
  await expect(
    db.financeForecast.delete({ where: { id: f.id } }),
  ).rejects.toThrow(/FINANCE_PLAN_RETAINED/);
});
it("planning request receipts enforce intent and current version", async () => {
  const p = await project(),
    key = crypto.randomUUID(),
    one = await plan("FORECAST_CREATE", forecastBody(p.id), key),
    two = await plan("FORECAST_CREATE", forecastBody(p.id), key);
  expect(two).toEqual(one);
  await expect(
    plan("FORECAST_CREATE", forecastBody(p.id, { amount: "2.00" }), key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  await expect(
    plan("FORECAST_CANCEL", {
      id: one.id,
      expectedVersion: 9,
      reason: "Cannot act on stale plan",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
});
it("current finance selection is required before parsing private plans, variance or future forecasts", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(budgetDetail(people[who], "bad-id")).rejects.toMatchObject({
      status: 403,
    });
    await expect(budgetVariance(people[who], {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(forecasts(people[who], {})).rejects.toMatchObject({
      status: 403,
    });
  }
  expect(
    (await planningOptions(people.selected, { kind: "PARTY", q: prefix })).items
      .length,
  ).toBeGreaterThan(0);
});
it("revisions cannot reference another project, month or stale approval", async () => {
  const p = await project(),
    q = await project(),
    a = await expense(),
    one = await plan("BUDGET_CREATE", budgetBody(p.id, a));
  await approve(one);
  for (const patch of [
    { projectId: q.id, previousId: one.id, previousVersion: 2 },
    { previousId: null, previousVersion: null },
    { previousId: one.id, previousVersion: 1 },
    { month: "9998-01", previousId: one.id, previousVersion: 2 },
  ])
    await expect(
      plan("BUDGET_CREATE", budgetBody(p.id, a, patch)),
    ).rejects.toMatchObject({ code: "FINANCE_BUDGET_REVISION" });
});
it("direct forged approval snapshots and empty drafts fail deferred consistency checks", async () => {
  const p = await project(),
    a = await expense(),
    d = await plan("BUDGET_CREATE", budgetBody(p.id, a));
  await expect(
    db.$transaction(async (tx) => {
      await tx.financeBudget.update({
        where: { id: d.id },
        data: {
          state: "APPROVED",
          version: 2,
          approvalEvidence: "Forged approval source",
          approvedAt: new Date(),
          approvedById: people.owner.id,
          snapshot: { forged: true },
        },
      });
    }),
  ).rejects.toThrow(/FINANCE_BUDGET_SNAPSHOT/);
  expect((await budgetDetail(people.owner, d.id)).item.state).toBe("DRAFT");
  await expect(
    db.$transaction(async (tx) => {
      await tx.financeBudgetLine.deleteMany({ where: { budgetId: d.id } });
    }),
  ).rejects.toThrow(/FINANCE_BUDGET_TOTAL/);
});
it("runtime and Data API cannot write planning sources, issue numbers or call internal snapshots", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"]) {
      await sql.query("SET ROLE " + role);
      const r = (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceBudget"','UPDATE') AS write,has_function_privilege(current_user,'encova_finance_budget_snapshot(uuid)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_budget_number','USAGE') AS number,has_function_privilege(current_user,'encova_finance_planning_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command`,
        )
      ).rows[0];
      expect(r).toEqual({
        write: false,
        helper: false,
        number: false,
        command: role === "encova_app",
      });
      await sql.query("RESET ROLE");
    }
  } finally {
    await sql.end();
  }
});
it("private register filters are bounded and distinguish budgets from forecast cash plans", async () => {
  const p = await project(),
    a = await expense(),
    b = await plan("BUDGET_CREATE", budgetBody(p.id, a)),
    f = await plan("FORECAST_CREATE", forecastBody(p.id));
  expect(
    (await budgets(people.owner, { projectId: p.id, q: prefix })).items.map(
      (v) => v.id,
    ),
  ).toEqual([b.id]);
  expect(
    (
      await forecasts(people.owner, {
        projectId: p.id,
        from: "9999-01-01",
        to: "9999-12-31",
      })
    ).items.map((v) => v.id),
  ).toEqual([f.id]);
  await expect(
    forecasts(people.owner, { from: "9999-01-01", to: "0001-01-01" }),
  ).rejects.toThrow();
});
it("checked SQL rejects nonstring forecast evidence without bypassing the command's source contract", async () => {
  const session = await db.session.findFirstOrThrow({
    where: { userId: people.owner.authUserId! },
    orderBy: { createdAt: "desc" },
  });
  await expect(
    db.$queryRaw`SELECT public.encova_finance_planning_command(${people.owner.id}::uuid,'better-auth',${session.id},CURRENT_TIMESTAMP,'FORECAST_CREATE',${JSON.stringify({ ...forecastBody(null), description: 123 })}::jsonb,${crypto.randomUUID()},${crypto.randomUUID()}::uuid)`,
  ).rejects.toThrow(/FINANCE_INVALID_INPUT/);
});
it("planning HTTP responses stay private and gate capability, Origin, disabled feature and fresh verification", async () => {
  const { planningRead, planningMutation } =
    await import("@/modules/finance/planning/http");
  for (const who of ["other", "hr", "lead", "member"]) {
    const r = await planningRead(req(who), "BUDGET");
    expect(r.status).toBe(403);
    expect(r.headers.get("cache-control")).toContain("no-store");
  }
  const bad = req("owner", { ...forecastBody(null), reauth: { password } });
  bad.headers.set("origin", "https://attacker.example.test");
  expect((await planningMutation(bad, "FORECAST_CREATE")).status).toBe(403);
  const r = await planningMutation(
    req("selected", { ...forecastBody(null), reauth: { password } }),
    "FORECAST_CREATE",
  );
  expect(r.status).toBe(201);
  expect(r.headers.get("cache-control")).toContain("no-store");
  env.FINANCE_ENABLED = false;
  try {
    expect((await planningRead(req(), "BUDGET")).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
