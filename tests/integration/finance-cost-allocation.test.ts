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
const { invoiceCommand } =
  await import("@/modules/finance/receivables/service");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "CA28." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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
async function command(
  action: Parameters<typeof invoiceCommand>[2],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return invoiceCommand(v.actor, v.proof, action, body, key);
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
  ar = await account({
    controlType: "RECEIVABLES",
    type: "ASSET",
    normalSide: "DEBIT",
    reportGroup: "CURRENT_ASSETS",
  });
  revenue = await account({
    type: "INCOME",
    normalSide: "CREDIT",
    reportGroup: "REVENUE",
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

const {
  costAllocationCommand,
  costSourceDetail,
  costSources,
  costAllocationDetail,
  costPercentagePreview,
  projectFinancialResult,
} = await import("@/modules/finance/projects/costs/service");
const { billCommand, billDetail } =
  await import("@/modules/finance/payables/service");
const { supplierCommand } =
  await import("@/modules/finance/payables/supplier/service");
async function cost(
  action: Parameters<typeof costAllocationCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const p = await proof(who);
  return costAllocationCommand(p.actor, p.proof, action, input, key);
}
async function bill(action: Parameters<typeof billCommand>[2], input: unknown) {
  const p = await proof();
  return billCommand(p.actor, p.proof, action, input, crypto.randomUUID());
}
async function credit(
  action: "CREATE" | "POST" | "UPDATE" | "REVERSE",
  input: unknown,
) {
  const p = await proof();
  return supplierCommand(
    p.actor,
    p.proof,
    "SUPPLIER_CREDIT",
    action,
    input,
    crypto.randomUUID(),
  );
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
  const advance = await account({ controlType: "SUPPLIER_ADVANCE" });
  return { supplier, expense, ap, advance, b, line: l };
}
async function allocation(
  s: Awaited<ReturnType<typeof source>>,
  targets: { projectId: string | null; amount: string }[],
  patch: Record<string, unknown> = {},
) {
  const basis = await costSourceDetail(people.owner, s.line.id);
  return cost("CREATE", {
    sourceLineId: s.line.id,
    postingDate: period.start,
    description: prefix + " reviewed project split",
    evidence: "Approved exact source allocation",
    basisHash: basis.basisHash,
    targets,
    reason: "Assign incurred cost",
    ...patch,
  });
}
const post = (d: { id: string; version: number }) =>
  cost("POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post reviewed cost split",
  });
const total = async (accountId: string) =>
  (
    await db.$queryRaw<
      { v: string }[]
    >`SELECT coalesce(sum(debit-credit),0)::text AS v FROM "FinanceJournalLine" WHERE "accountId"=${accountId}::uuid`
  )[0].v;
const creditBody = (
  s: Awaited<ReturnType<typeof source>>,
  patch: Record<string, unknown> = {},
) => ({
  reference: prefix + " credit " + ++count,
  partyId: s.supplier,
  documentDate: period.start,
  postingDate: period.end,
  description: "Reviewed source cost credit",
  evidence: "Actual supplier credit evidence",
  billId: s.b.item.id,
  advanceAccountId: s.advance,
  creditLines: [{ billLineId: s.b.item.lines[0].id, amount: "20.00" }],
  reason: "Correct source expense",
  ...patch,
});
it("full exact reclassification creates no draft GL then moves only project dimensions, preserving expense and party totals", async () => {
  const s = await source(),
    a = await project(),
    b = await project(),
    before = await total(s.expense),
    n = await db.financeJournalEntry.count(),
    d = await allocation(s, [
      { projectId: a.id, amount: "70.00" },
      { projectId: b.id, amount: "20.00" },
      { projectId: null, amount: "30.00" },
    ]);
  expect(await db.financeJournalEntry.count()).toBe(n);
  const posted = await post(d),
    j = await db.financeJournalEntry.findUniqueOrThrow({
      where: { id: posted.journalId! },
      include: { lines: { orderBy: { sequence: "asc" } } },
    });
  expect(j.lines).toHaveLength(4);
  expect(new Set(j.lines.map((l) => l.accountId))).toEqual(
    new Set([s.expense]),
  );
  expect(j.lines.every((l) => l.partyId === s.supplier)).toBe(true);
  expect(await total(s.expense)).toBe(before);
  expect(j.lines.find((l) => l.sequence === 201)?.credit.toFixed(2)).toBe(
    "120.00",
  );
});
it("incomplete or duplicate splits cannot save and unchanged dimensions cannot post", async () => {
  const p = await project(),
    s = await source("120.00", p.id);
  await expect(
    allocation(s, [{ projectId: p.id, amount: "119.99" }]),
  ).rejects.toMatchObject({ code: "FINANCE_COST_SPLIT" });
  await expect(
    allocation(s, [
      { projectId: p.id, amount: "60.00" },
      { projectId: p.id, amount: "60.00" },
    ]),
  ).rejects.toThrow();
  const d = await allocation(s, [{ projectId: p.id, amount: "120.00" }]);
  await expect(post(d)).rejects.toMatchObject({
    code: "FINANCE_COST_NO_CHANGE",
  });
});
it("concurrent posts cannot allocate one source twice and committed retries retain one journal", async () => {
  const p = await project(),
    s = await source(),
    a = await allocation(s, [{ projectId: p.id, amount: "120.00" }]),
    b = await allocation(s, [{ projectId: p.id, amount: "120.00" }]),
    r = await Promise.allSettled([post(a), post(b)]);
  expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
  const s2 = await source(),
    d = await allocation(s2, [{ projectId: p.id, amount: "120.00" }]),
    key = crypto.randomUUID(),
    body = { id: d.id, expectedVersion: 1, reason: "Same reviewed request" },
    one = await cost("POST", body, key),
    two = await cost("POST", body, key);
  expect(two).toEqual(one);
  expect(
    await db.financeJournalEntry.count({ where: { costAllocationId: d.id } }),
  ).toBe(1);
});
it("source credits make drafts stale and a reviewed update saves the new net split on the same source", async () => {
  const p = await project(),
    s = await source(),
    d = await allocation(s, [{ projectId: p.id, amount: "120.00" }], {
      postingDate: period.end,
    }),
    c = await credit("CREATE", creditBody(s));
  await credit("POST", {
    id: c.id,
    expectedVersion: 1,
    reason: "Post actual cost credit",
  });
  await expect(post(d)).rejects.toMatchObject({
    code: "FINANCE_COST_STALE_BASIS",
  });
  const current = await costSourceDetail(people.owner, s.line.id);
  expect(current.item.net).toBe("100.00");
  const saved = await cost("UPDATE", {
    id: d.id,
    expectedVersion: 1,
    postingDate: period.end,
    description: "Reviewed revised cost",
    evidence: "Credit included in source basis",
    basisHash: current.basisHash,
    targets: [{ projectId: p.id, amount: "100.00" }],
    reason: "Review new remaining cost",
  });
  expect(saved.id).toBe(d.id);
  await post(saved);
});
it("a source credit is blocked until its allocation is reversed at a compatible date", async () => {
  const p = await project(),
    s = await source(),
    d = await allocation(s, [{ projectId: p.id, amount: "120.00" }]);
  await post(d);
  const c = await credit("CREATE", creditBody(s));
  await expect(
    credit("POST", {
      id: c.id,
      expectedVersion: 1,
      reason: "Cannot remove allocated cost",
    }),
  ).rejects.toThrow(/FINANCE_COST_CAPACITY|Cost would be overallocated/);
  await cost("REVERSE", {
    id: d.id,
    expectedVersion: 2,
    postingDate: period.end,
    reason: "Return cost before underlying credit",
  });
  await credit("POST", {
    id: c.id,
    expectedVersion: 1,
    reason: "Post cost credit after correction",
  });
  expect((await costSourceDetail(people.owner, s.line.id)).item.net).toBe(
    "100.00",
  );
  const next = await allocation(s, [{ projectId: p.id, amount: "100.00" }], {
    postingDate: period.end,
  });
  await post(next);
  expect(await total(s.expense)).toBe("100.00");
});
it("backdated source credits cannot invalidate an earlier allocated interval even after its later reversal", async () => {
  const p = await project(),
    s = await source(),
    dt = new Date(period.start);
  dt.setUTCDate(dt.getUTCDate() + 2);
  const date = dt.toISOString().slice(0, 10),
    d = await allocation(s, [{ projectId: p.id, amount: "120.00" }], {
      postingDate: date,
    });
  await post(d);
  await cost("REVERSE", {
    id: d.id,
    expectedVersion: 2,
    postingDate: period.end,
    reason: "Later allocation correction",
  });
  const c = await credit(
    "CREATE",
    creditBody(s, { postingDate: period.start }),
  );
  await expect(
    credit("POST", {
      id: c.id,
      expectedVersion: 1,
      reason: "Refuse retroactive over-allocation",
    }),
  ).rejects.toThrow(/FINANCE_COST_CAPACITY|Cost would be overallocated/);
});
it("a reversed supplier credit restores the canonical bill pool without creating a second allocatable source", async () => {
  const s = await source(),
    c = await credit("CREATE", creditBody(s));
  await credit("POST", { id: c.id, expectedVersion: 1, reason: "Reduce cost" });
  const rev = await credit("REVERSE", {
      id: c.id,
      expectedVersion: 2,
      postingDate: period.end,
      reason: "Restore original cost",
    }),
    e = await db.financeJournalEntry.findUniqueOrThrow({
      where: { id: rev.journalId! },
      include: { lines: true },
    }),
    positive = e.lines.find((l) => l.accountId === s.expense && l.debit.gt(0))!;
  expect((await costSourceDetail(people.owner, s.line.id)).item.net).toBe(
    "120.00",
  );
  await expect(
    costSourceDetail(people.owner, positive.id),
  ).rejects.toMatchObject({ code: "FINANCE_COST_SOURCE" });
});
it("dated opposite journals retain original targets and posted allocations/lines cannot be edited or deleted", async () => {
  const p = await project(),
    s = await source(),
    d = await allocation(s, [{ projectId: p.id, amount: "120.00" }]);
  await post(d);
  const r = await cost("REVERSE", {
      id: d.id,
      expectedVersion: 2,
      postingDate: period.end,
      reason: "Correct target assignment",
    }),
    original = await costAllocationDetail(people.owner, d.id);
  expect(original.item.reversedBy?.id).toBe(r.reversalId);
  expect(await total(s.expense)).toBe("120.00");
  await expect(
    db.financeCostAllocationLine.update({
      where: { id: original.item.targets[0].id },
      data: { amount: "1.00" },
    }),
  ).rejects.toThrow(/FINANCE_COST_IMMUTABLE/);
  await expect(
    db.financeCostAllocation.delete({ where: { id: d.id } }),
  ).rejects.toThrow(/FINANCE_COST_IMMUTABLE/);
  await expect(
    cost("REVERSE", {
      id: d.id,
      expectedVersion: 2,
      postingDate: period.end,
      reason: "No second opposite correction",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_REVERSAL_INVALID" });
});
it("percentage preview uses actual source money without posting and rejects stale or missing project dimensions", async () => {
  const s = await source("0.03"),
    a = await project(),
    b = await project(),
    c = await project(),
    basis = await costSourceDetail(people.owner, s.line.id),
    before = await db.financeJournalEntry.count(),
    r = await costPercentagePreview(people.owner, {
      sourceLineId: s.line.id,
      basisHash: basis.basisHash,
      targets: [
        { projectId: a.id, percentage: "33.333333" },
        { projectId: b.id, percentage: "33.333333" },
        { projectId: c.id, percentage: "33.333334" },
      ],
    });
  expect(r.targets.map((t) => t.amount)).toEqual(["0.01", "0.01", "0.01"]);
  expect(await db.financeJournalEntry.count()).toBe(before);
  await expect(
    costPercentagePreview(people.owner, {
      sourceLineId: s.line.id,
      basisHash: basis.basisHash,
      targets: [{ projectId: crypto.randomUUID(), percentage: "100" }],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PROJECT_UNAVAILABLE" });
});
it("project results use posted earned income and unpaid incurred cost, with reclassification preserving company profit", async () => {
  const p = await project(),
    s = await source(),
    inv = await command("CREATE", {
      partyId: client,
      receivableAccountId: ar,
      projectId: p.id,
      invoiceDate: period.start,
      postingDate: period.start,
      dueDate: period.end,
      description: "Earned project delivery",
      evidence: "Reviewed delivery",
      lines: [
        {
          description: "Earned work",
          quantity: "1",
          unitRate: "300.00",
          recognition: "EARNED",
          revenueAccountId: revenue,
        },
      ],
      reason: "Recognize actual earned work",
    });
  await command("POST", {
    id: inv.id,
    expectedVersion: 1,
    reason: "Post earned source",
  });
  const before = await total(s.expense),
    d = await allocation(s, [{ projectId: p.id, amount: "120.00" }]);
  await post(d);
  const result = await projectFinancialResult(people.owner, p.id, {
    from: period.start,
    to: period.end,
  });
  expect(result.values).toMatchObject({
    netInvoiced: "300.00",
    recognizedIncome: "300.00",
    directCosts: "120.00",
    assignedOverhead: "0.00",
    contribution: "180.00",
    fullyAllocatedResult: "180.00",
  });
  expect((await billDetail(people.owner, s.b.item.id)).payableBalance).toBe(
    "120.00",
  );
  expect(await total(s.expense)).toBe(before);
});
it("lower roles/unselected roots cannot query costs, result amounts or typed read wrappers through services", async () => {
  const s = await source(),
    p = await project();
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(costSourceDetail(people[who], "bad-id")).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(costSources(people[who], {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      projectFinancialResult(people[who], p.id),
    ).rejects.toMatchObject({ status: 403 });
  }
  expect(
    (await costSources(people.owner, { q: prefix })).items.some(
      (i) => i.id === s.line.id,
    ),
  ).toBe(true);
});
it("runtime receives only checked read/write interfaces and cannot mutate sources or call generic helpers", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    expect(
      (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceCostAllocation"','SELECT') AS read,has_table_privilege(current_user,'"FinanceCostAllocationLine"','UPDATE') AS write,has_function_privilege(current_user,'encova_finance_cost_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_cost_read(uuid,jsonb)','EXECUTE') AS checkedread,has_function_privilege(current_user,'encova_finance_cost_components(uuid)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_cost_allocation_number','USAGE') AS number`,
        )
      ).rows[0],
    ).toEqual({
      read: true,
      write: false,
      command: true,
      checkedread: true,
      helper: false,
      number: false,
    });
  } finally {
    await sql.end();
  }
});
it("manual expense sources use the same ledger guard and cannot be reversed while allocated", async () => {
  const { ledgerCommand } = await import("@/modules/finance/ledger/service");
  const ledger = async (
    action: Parameters<typeof ledgerCommand>[2],
    body: unknown,
  ) => {
    const v = await proof();
    return ledgerCommand(v.actor, v.proof, action, body, crypto.randomUUID());
  };
  const expense = await account({
      type: "OPERATING_EXPENSE",
      normalSide: "DEBIT",
      reportGroup: "OPERATING_EXPENSES",
    }),
    offset = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    }),
    p = await project();
  const d = await ledger("CREATE", {
    reference: prefix + " manual " + ++count,
    postingDate: period.start,
    description: "Manual incurred overhead",
    evidence: "Reviewed accrual source",
    lines: [
      {
        accountId: expense,
        description: "Incurred overhead",
        debit: "80.03",
        credit: "0.00",
      },
      {
        accountId: offset,
        description: "Accrued payable",
        debit: "0.00",
        credit: "80.03",
      },
    ],
    reason: "Recognize evidenced accrual",
  });
  await ledger("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post accrued source",
  });
  const line = await db.financeJournalLine.findFirstOrThrow({
      where: {
        journal: { sourceType: "JOURNAL_DRAFT", sourceId: d.id },
        accountId: expense,
      },
    }),
    basis = await costSourceDetail(people.owner, line.id);
  const allocation = await cost("CREATE", {
    sourceLineId: line.id,
    basisHash: basis.basisHash,
    postingDate: period.start,
    description: "Allocate overhead exactly",
    evidence: "Approved overhead split",
    targets: [
      { projectId: p.id, amount: "50.01" },
      { projectId: null, amount: "30.02" },
    ],
    reason: "Assign incurred overhead",
  });
  await post(allocation);
  const result = await projectFinancialResult(people.owner, p.id, {
    from: period.start,
    to: period.end,
  });
  expect(result.values).toMatchObject({
    recognizedIncome: "0.00",
    directCosts: "0.00",
    assignedOverhead: "50.01",
    contribution: "0.00",
    fullyAllocatedResult: "-50.01",
  });
  await expect(
    ledger("REVERSE", {
      id: d.id,
      expectedVersion: 2,
      postingDate: period.end,
      reason: "Cannot erase allocated source",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_COST_CAPACITY", status: 409 });
  await cost("REVERSE", {
    id: allocation.id,
    expectedVersion: 2,
    postingDate: period.end,
    reason: "Release allocation before source reversal",
  });
  await ledger("REVERSE", {
    id: d.id,
    expectedVersion: 2,
    postingDate: period.end,
    reason: "Reverse released source",
  });
  expect((await costSourceDetail(people.owner, line.id)).item.net).toBe("0.00");
});
it("deferred invoice plans are net invoiced but not earned income and draft/void costs have no result effect", async () => {
  const p = await project(),
    deferred = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "DEFERRED_REVENUE",
    });
  const i = await command("CREATE", {
    partyId: client,
    receivableAccountId: ar,
    projectId: p.id,
    invoiceDate: period.start,
    postingDate: period.start,
    dueDate: period.end,
    description: "Advance billed project",
    evidence: "Deferred performance evidence",
    lines: [
      {
        description: "Future delivery",
        quantity: "1",
        unitRate: "100.01",
        recognition: "DEFERRED",
        revenueAccountId: revenue,
        deferredAccountId: deferred,
      },
    ],
    reason: "Bill before performance",
  });
  await command("POST", {
    id: i.id,
    expectedVersion: 1,
    reason: "Post advance billed source",
  });
  const s = await source(),
    d = await allocation(s, [{ projectId: p.id, amount: "120.00" }]);
  await cost("VOID", {
    id: d.id,
    expectedVersion: 1,
    reason: "Retain unused draft",
  });
  expect(
    (
      await projectFinancialResult(people.owner, p.id, {
        from: period.start,
        to: period.end,
      })
    ).values,
  ).toMatchObject({
    netInvoiced: "100.01",
    recognizedIncome: "0.00",
    directCosts: "0.00",
    contribution: "0.00",
  });
  await expect(post({ ...d, version: 2 })).rejects.toMatchObject({
    status: 409,
  });
  expect(
    await db.financeJournalEntry.count({ where: { costAllocationId: d.id } }),
  ).toBe(0);
});
it("private HTTP source/results/preview deny ordinary roles and disabled finance; preview requires origin and never posts", async () => {
  const { costRead, costPreview, costMutation } =
      await import("@/modules/finance/projects/costs/http"),
    s = await source("0.03"),
    p = await project(),
    basis = await costSourceDetail(people.owner, s.line.id);
  for (const who of ["other", "hr", "lead", "member"]) {
    const r = await costRead(req(who), "RESULT", p.id);
    expect(r.status).toBe(403);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(await r.text()).not.toContain(p.name);
  }
  const body = {
      sourceLineId: s.line.id,
      basisHash: basis.basisHash,
      targets: [{ projectId: p.id, percentage: "100" }],
    },
    before = await db.financeJournalEntry.count();
  const r = await costPreview(req("owner", body));
  expect(r.status).toBe(200);
  expect((await r.json()).data.targets[0].amount).toBe("0.03");
  expect(await db.financeJournalEntry.count()).toBe(before);
  const bad = req("owner", body);
  bad.headers.set("origin", "https://attacker.example.test");
  expect((await costPreview(bad)).status).toBe(403);
  env.FINANCE_ENABLED = false;
  try {
    expect((await costRead(req(), "SOURCE", s.line.id)).status).toBe(404);
    expect((await costMutation(req("owner", {}), "CREATE")).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
