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
const { invoiceCommand, invoiceDetail } =
  await import("@/modules/finance/receivables/service");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "PC27." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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
  projectFinanceCommand,
  projectFinanceDetail,
  commercialProjects,
  commercialChildren,
  commercialChildDetail,
  projectFinanceOptions,
} = await import("@/modules/finance/projects/service");
async function commercial(
  action: Parameters<typeof projectFinanceCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return projectFinanceCommand(v.actor, v.proof, action, input, key);
}
async function project() {
  return db.project.create({
    data: {
      name: prefix + " project " + ++count,
      description: "Synthetic ordinary work",
      managerId: people.lead.id,
      members: { create: { userId: people.lead.id } },
    },
  });
}
const profileBody = (
  projectId: string,
  patch: Record<string, unknown> = {},
) => ({
  projectId,
  clientId: client,
  originalContract: "100.01",
  billingModel: "MILESTONE",
  terms: "Restricted signed commercial terms",
  evidence: "Synthetic contract evidence",
  reason: "Review project contract",
  ...patch,
});
async function active(patch: Record<string, unknown> = {}) {
  const p = await project(),
    body = profileBody(p.id, patch),
    draft = await commercial("PROFILE_CREATE", body),
    a = await commercial("PROFILE_ACTIVATE", {
      id: p.id,
      expectedVersion: 1,
      signedDate: period.start,
      approvalEvidence: "Explicit synthetic signed contract approval",
      reason: "Activate reviewed commercial plan",
    });
  return { p, body, draft, a };
}
const variation = (projectId: string, patch: Record<string, unknown> = {}) => ({
  projectId,
  direction: "INCREASE",
  amount: "20.02",
  reference: prefix + " variation " + ++count,
  description: "Reviewed signed commercial amendment",
  signedDate: period.start,
  evidence: "Signed synthetic amendment",
  reason: "Review contract variation",
  ...patch,
});
const milestone = (projectId: string, patch: Record<string, unknown> = {}) => ({
  projectId,
  description: prefix + " billing stage " + ++count,
  amount: "50.00",
  expectedDate: period.start,
  dueDate: period.end,
  evidence: "Synthetic billing plan",
  reason: "Review billing milestone",
  ...patch,
});
async function confirmed(projectId: string) {
  const d = await commercial("MILESTONE_CREATE", milestone(projectId));
  return commercial("MILESTONE_CONFIRM", {
    id: d.id,
    expectedVersion: 1,
    approvalEvidence: "Explicit billing plan approval",
    reason: "Confirm payment plan, no posting",
  });
}
async function invoice(
  projectId: string,
  patch: Record<string, unknown> = {},
  post = true,
) {
  const d = await command("CREATE", {
    reference: prefix + " invoice " + ++count,
    partyId: client,
    receivableAccountId: ar,
    projectId,
    invoiceDate: period.start,
    postingDate: period.start,
    dueDate: period.end,
    description: "Earned source for commercial link",
    evidence: "Reviewed delivery evidence",
    lines: [
      {
        description: "Earned delivery",
        quantity: "1",
        unitRate: "10.01",
        recognition: "EARNED",
        revenueAccountId: revenue,
      },
    ],
    reason: "Draft invoice explicitly",
    ...patch,
  });
  if (post)
    await command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Recognize reviewed delivery",
    });
  return invoiceDetail(people.owner, d.id);
}
it("profile creation has one immutable ERP project identity and permanent replay, without any accounting entry", async () => {
  const p = await project(),
    b = profileBody(p.id),
    key = crypto.randomUUID(),
    before = await db.financeJournalEntry.count(),
    d = await commercial("PROFILE_CREATE", b, key);
  expect(d.id).toBe(p.id);
  expect(d.financeId).not.toBe(p.id);
  expect(await commercial("PROFILE_CREATE", b, key)).toEqual(d);
  await expect(
    commercial("PROFILE_CREATE", { ...b, terms: "Different agreement" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  await expect(commercial("PROFILE_CREATE", b)).rejects.toMatchObject({
    code: "FINANCE_DUPLICATE",
  });
  expect((await projectFinanceDetail(people.owner, p.id)).item.state).toBe(
    "DRAFT",
  );
  expect(await db.financeJournalEntry.count()).toBe(before);
});
it("activation requires a signed reviewed positive agreement and freezes original client/contract/terms", async () => {
  const p = await project(),
    b = profileBody(p.id),
    d = await commercial("PROFILE_CREATE", b);
  await expect(
    commercial("PROFILE_ACTIVATE", {
      id: p.id,
      expectedVersion: 1,
      signedDate: "9999-12-31",
      approvalEvidence: "Future signature is not adopted",
      reason: "Refuse future signoff",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_COMMERCIAL_REVIEW" });
  await commercial("PROFILE_ACTIVATE", {
    id: p.id,
    expectedVersion: d.version,
    signedDate: period.start,
    approvalEvidence: "Actual synthetic signed agreement",
    reason: "Confirm agreement",
  });
  const { projectId, ...edit } = b;
  void projectId;
  await expect(
    commercial("PROFILE_UPDATE", {
      ...edit,
      id: p.id,
      expectedVersion: 2,
      originalContract: "200.00",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_COMMERCIAL_IMMUTABLE" });
  await expect(
    db.$executeRaw`UPDATE "FinanceProjectProfile" SET "originalContract"=200,version=version+1 WHERE "projectId"=${p.id}::uuid`,
  ).rejects.toThrow(/FINANCE_COMMERCIAL_IMMUTABLE/);
  await expect(active({ originalContract: "0.00" })).rejects.toMatchObject({
    code: "FINANCE_COMMERCIAL_REVIEW",
  });
});
it("only approved variations change exact contract value and over-decreases roll back while approved sources remain immutable", async () => {
  const { p } = await active(),
    draft = await commercial("VARIATION_CREATE", variation(p.id)),
    before = await db.financeJournalEntry.count();
  expect(
    (await projectFinanceDetail(people.owner, p.id)).totals.contractValue,
  ).toBe("100.01");
  await commercial("VARIATION_APPROVE", {
    id: draft.id,
    expectedVersion: 1,
    approvalEvidence: "Signed amendment reviewed",
    reason: "Approve increase",
  });
  const down = await commercial(
    "VARIATION_CREATE",
    variation(p.id, { direction: "DECREASE", amount: "20.01" }),
  );
  await commercial("VARIATION_APPROVE", {
    id: down.id,
    expectedVersion: 1,
    approvalEvidence: "Signed reduction reviewed",
    reason: "Approve reduction",
  });
  expect((await projectFinanceDetail(people.owner, p.id)).totals).toMatchObject(
    {
      contractValue: "100.02",
      approvedIncrease: "20.02",
      approvedDecrease: "20.01",
    },
  );
  const over = await commercial(
    "VARIATION_CREATE",
    variation(p.id, { direction: "DECREASE", amount: "100.03" }),
  );
  await expect(
    commercial("VARIATION_APPROVE", {
      id: over.id,
      expectedVersion: 1,
      approvalEvidence: "Reviewed impossible reduction",
      reason: "Refuse negative contract",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_COMMERCIAL_CAPACITY" });
  expect(
    (await commercialChildDetail(people.owner, "VARIATION", over.id)).item
      .state,
  ).toBe("DRAFT");
  await expect(
    commercial("VARIATION_VOID", {
      id: draft.id,
      expectedVersion: 2,
      reason: "Cannot remove approved agreement",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_COMMERCIAL_IMMUTABLE" });
  expect(await db.financeJournalEntry.count()).toBe(before);
});
it("concurrent approved decreases cannot jointly consume more contract value", async () => {
  const { p } = await active(),
    a = await commercial(
      "VARIATION_CREATE",
      variation(p.id, { direction: "DECREASE", amount: "70.00" }),
    ),
    b = await commercial(
      "VARIATION_CREATE",
      variation(p.id, { direction: "DECREASE", amount: "70.00" }),
    );
  const result = await Promise.allSettled(
    [a, b].map((d) =>
      commercial("VARIATION_APPROVE", {
        id: d.id,
        expectedVersion: 1,
        approvalEvidence: "Signed reduction reviewed",
        reason: "Concurrent contract reduction",
      }),
    ),
  );
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await projectFinanceDetail(people.owner, p.id)).totals.contractValue,
  ).toBe("30.01");
});
it("confirmed milestone plans and status changes create no revenue, cash or journal; overplanning remains advisory", async () => {
  const { p } = await active(),
    before = await db.financeJournalEntry.count(),
    d = await commercial(
      "MILESTONE_CREATE",
      milestone(p.id, { amount: "1000.00" }),
    );
  await commercial("MILESTONE_CONFIRM", {
    id: d.id,
    expectedVersion: 1,
    approvalEvidence: "Explicit synthetic plan review",
    reason: "Confirm plan only",
  });
  expect((await projectFinanceDetail(people.owner, p.id)).totals).toMatchObject(
    { confirmedMilestones: "1000.00", overplanned: true },
  );
  const { projectId, ...edit } = milestone(p.id);
  void projectId;
  await expect(
    commercial("MILESTONE_UPDATE", { ...edit, id: d.id, expectedVersion: 2 }),
  ).rejects.toMatchObject({ code: "FINANCE_COMMERCIAL_IMMUTABLE" });
  await commercial("PROFILE_CLOSE", {
    id: p.id,
    expectedVersion: 2,
    reason: "Close commercial planning",
  });
  await commercial("PROFILE_REOPEN", {
    id: p.id,
    expectedVersion: 3,
    reason: "Reopen retained commercial record",
  });
  await commercial("MILESTONE_CANCEL", {
    id: d.id,
    expectedVersion: 2,
    reason: "Withdraw confirmed unbilled plan",
  });
  expect(
    (await projectFinanceDetail(people.owner, p.id)).totals.confirmedMilestones,
  ).toBe("0.00");
  expect(await db.financeJournalEntry.count()).toBe(before);
});
it("linking an actual posted line snapshots its original net, adds no GL and preserves invoice source history", async () => {
  const { p } = await active(),
    m = await confirmed(p.id),
    i = await invoice(p.id),
    before = await db.financeJournalEntry.count(),
    l = await commercial("LINK_CREATE", {
      milestoneId: m.id,
      invoiceLineId: i.item.lines[0].id,
      reason: "Link actual reviewed invoice line",
    });
  const d = await commercialChildDetail(people.owner, "MILESTONE", m.id);
  if (d.kind !== "MILESTONE") throw Error("Milestone required");
  expect(d.links[0]).toMatchObject({
    id: l.id,
    originalNet: "10.01",
    state: "ACTIVE",
    snapshot: { netAmount: "10.01", taxAmount: "0.00", currency: "PKR" },
  });
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect(
    (await invoiceDetail(people.owner, i.item.id)).item.lines[0].netAmount,
  ).toBe("10.01");
});
it("invoice annotations reject drafts, other projects/clients and duplicate active use", async () => {
  const { p } = await active(),
    other = await project(),
    m = await confirmed(p.id),
    m2 = await confirmed(p.id),
    draft = await invoice(p.id, {}, false),
    foreign = await invoice(other.id),
    otherClient = await party(),
    wrongClient = await invoice(p.id, { partyId: otherClient });
  for (const i of [draft, foreign, wrongClient])
    await expect(
      commercial("LINK_CREATE", {
        milestoneId: m.id,
        invoiceLineId: i.item.lines[0].id,
        reason: "Refuse unrelated or unposted invoice",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_COMMERCIAL_SOURCE" });
  const valid = await invoice(p.id);
  await commercial("LINK_CREATE", {
    milestoneId: m.id,
    invoiceLineId: valid.item.lines[0].id,
    reason: "Link eligible invoice",
  });
  await expect(
    commercial("LINK_CREATE", {
      milestoneId: m2.id,
      invoiceLineId: valid.item.lines[0].id,
      reason: "Cannot annotate same line twice",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_DUPLICATE" });
});
it("release retains the annotation, enables reviewed relinking and is required before milestone cancellation", async () => {
  const { p } = await active(),
    m = await confirmed(p.id),
    other = await confirmed(p.id),
    i = await invoice(p.id),
    l = await commercial("LINK_CREATE", {
      milestoneId: m.id,
      invoiceLineId: i.item.lines[0].id,
      reason: "Bind source",
    }),
    before = await db.financeJournalEntry.count();
  await expect(
    commercial("MILESTONE_CANCEL", {
      id: m.id,
      expectedVersion: 2,
      reason: "Refuse losing active invoice relationship",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_COMMERCIAL_LINKED" });
  await commercial("LINK_RELEASE", {
    id: l.id,
    expectedVersion: 1,
    reason: "Correct relationship without changing invoice",
  });
  await commercial("MILESTONE_CANCEL", {
    id: m.id,
    expectedVersion: 2,
    reason: "Cancel released milestone",
  });
  await commercial("LINK_CREATE", {
    milestoneId: other.id,
    invoiceLineId: i.item.lines[0].id,
    reason: "Relink same retained line after review",
  });
  expect(
    await db.financeMilestoneInvoiceLink.count({
      where: { invoiceLineId: i.item.lines[0].id },
    }),
  ).toBe(2);
  expect(await db.financeJournalEntry.count()).toBe(before);
  await expect(
    db.$executeRaw`UPDATE "FinanceMilestoneInvoiceLink" SET "originalNet"=1,version=version+1 WHERE id=${l.id}::uuid`,
  ).rejects.toThrow(/FINANCE_COMMERCIAL_IMMUTABLE/);
});
it("contract snapshots survive master renaming and archived operational projects retain valid financial relationships", async () => {
  const { p } = await active(),
    m = await confirmed(p.id),
    i = await invoice(p.id),
    old = (await projectFinanceDetail(people.owner, p.id)).item
      .contractSnapshot;
  await db.financeParty.update({
    where: { id: client },
    data: { name: prefix + " renamed client", version: { increment: 1 } },
  });
  await db.project.update({
    where: { id: p.id },
    data: {
      name: prefix + " renamed",
      archivedAt: new Date(),
      version: { increment: 1 },
    },
  });
  await commercial("LINK_CREATE", {
    milestoneId: m.id,
    invoiceLineId: i.item.lines[0].id,
    reason: "Link legitimate billing history of archived work",
  });
  expect(
    (await projectFinanceDetail(people.owner, p.id)).item.contractSnapshot,
  ).toEqual(old);
  const { projectDetail } = await import("@/modules/projects/lifecycle"),
    ordinary = await projectDetail(people.lead, p.id);
  expect(ordinary).not.toHaveProperty("financeProfile");
  expect(JSON.stringify(ordinary)).not.toContain("originalContract");
});
it("managers, staff and unselected roots never gain commercial access; active selected roots have private paginated views", async () => {
  const { p } = await active();
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(projectFinanceDetail(people[who], p.id)).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      projectFinanceOptions(people[who], { kind: "CLIENT" }),
    ).rejects.toMatchObject({ status: 403 });
  }
  expect(
    (await commercialProjects(people.selected, { q: prefix })).items.some(
      (i) => i.projectId === p.id,
    ),
  ).toBe(true);
  const d = await commercial(
    "PROFILE_CREATE",
    profileBody((await project()).id),
    crypto.randomUUID(),
    "selected",
  );
  expect(d.version).toBe(1);
});
it("draft edits, stale versions and retained cancellations preserve the single project profile identity", async () => {
  const p = await project(),
    b = profileBody(p.id),
    d = await commercial("PROFILE_CREATE", b),
    { projectId, ...edit } = b;
  void projectId;
  const updated = await commercial("PROFILE_UPDATE", {
    ...edit,
    id: p.id,
    expectedVersion: 1,
    terms: "Revised unconfirmed terms",
  });
  await expect(
    commercial("PROFILE_CANCEL", {
      id: p.id,
      expectedVersion: 1,
      reason: "Stale cancel",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await commercial("PROFILE_CANCEL", {
    id: p.id,
    expectedVersion: updated.version,
    reason: "Retain withdrawn draft",
  });
  await commercial("PROFILE_REOPEN", {
    id: p.id,
    expectedVersion: 3,
    reason: "Restore same draft identity",
  });
  expect((await projectFinanceDetail(people.owner, p.id)).item.id).toBe(
    d.financeId,
  );
  await expect(
    db.financeProjectProfile.delete({ where: { projectId: p.id } }),
  ).rejects.toThrow(/FINANCE_COMMERCIAL_RETAINED/);
});
it("runtime/data API permissions deny raw financial changes, private source helpers and number sequences", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    expect(
      (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceProjectProfile"','SELECT') AS read,has_table_privilege(current_user,'"FinanceProjectVariation"','UPDATE') AS write,has_function_privilege(current_user,'encova_finance_project_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_project_contract(uuid)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_project_variation_number','USAGE') AS number`,
        )
      ).rows[0],
    ).toEqual({
      read: true,
      write: false,
      command: true,
      helper: false,
      number: false,
    });
    await sql.query("RESET ROLE");
    for (const role of ["anon", "authenticated"])
      expect(
        (
          await sql.query(
            `SELECT has_table_privilege($1,'"FinanceProjectProfile"','SELECT') AS read,has_function_privilege($1,'encova_finance_project_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command`,
            [role],
          )
        ).rows[0],
      ).toEqual({ read: false, command: false });
  } finally {
    await sql.end();
  }
});

it("HTTP capability checks precede invalid fields/IDs, mutations enforce Origin and all outcomes stay private", async () => {
  const { commercialRead, commercialMutation } =
    await import("@/modules/finance/projects/http");
  for (const who of ["other", "hr", "lead", "member"]) {
    expect((await commercialRead(req(who), "LINK", "not-an-id")).status).toBe(
      403,
    );
    expect(
      (
        await commercialMutation(
          req(who, { reauth: { password }, unexpected: true }),
          "PROFILE_CREATE",
        )
      ).status,
    ).toBe(403);
  }
  const read = await commercialRead(req(), "PROFILE");
  expect(read.status).toBe(200);
  expect(read.headers.get("cache-control")).toContain("no-store");
  const badOrigin = new Request(env.APP_URL + "/api/v1/finance/projects", {
    method: "POST",
    headers: {
      cookie: cookies.owner,
      origin: "https://unrelated.example.test",
      "x-encova-csrf": "1",
      "content-type": "application/json",
    },
    body: JSON.stringify({ reauth: { password } }),
  });
  expect((await commercialMutation(badOrigin, "PROFILE_CREATE")).status).toBe(
    403,
  );
  env.FINANCE_ENABLED = false;
  try {
    const r = await commercialRead(req(), "PROFILE");
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toContain("no-store");
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("stable complete pagination and source options retain bounded commercial data without hiding later rows", async () => {
  const { p } = await active();
  for (let n = 0; n < 26; n++)
    await commercial(
      "VARIATION_CREATE",
      variation(p.id, { reference: prefix + " page " + n, amount: "1.00" }),
    );
  const one = await commercialChildren(people.owner, "VARIATION", {
      projectId: p.id,
    }),
    two = await commercialChildren(people.owner, "VARIATION", {
      projectId: p.id,
      page: 2,
    });
  expect(one.items).toHaveLength(25);
  expect(two.items).toHaveLength(1);
  expect(new Set([...one.items, ...two.items].map((i) => i.id)).size).toBe(26);
  expect(
    (await projectFinanceDetail(people.owner, p.id)).totals.contractValue,
  ).toBe("100.01");
  const m = await confirmed(p.id),
    i = await invoice(p.id),
    before = await projectFinanceOptions(people.owner, {
      kind: "INVOICE_LINE",
      projectId: p.id,
      q: i.item.number,
    });
  expect(before.items.map((x) => x.id)).toContain(i.item.lines[0].id);
  await commercial("LINK_CREATE", {
    milestoneId: m.id,
    invoiceLineId: i.item.lines[0].id,
    reason: "Keep linked sources out of new choices",
  });
  expect(
    (
      await projectFinanceOptions(people.owner, {
        kind: "INVOICE_LINE",
        projectId: p.id,
        q: i.item.number,
      })
    ).items,
  ).toHaveLength(0);
});
it("deferred source proof rejects forged invoice-link values or snapshots even for an isolated operator", async () => {
  const { p } = await active(),
    m = await confirmed(p.id),
    i = await invoice(p.id);
  await expect(
    db.financeMilestoneInvoiceLink.create({
      data: {
        milestoneId: m.id,
        invoiceLineId: i.item.lines[0].id,
        originalNet: "1.00",
        snapshot: { forged: true },
        createdById: people.owner.id,
      },
    }),
  ).rejects.toThrow(/FINANCE_COMMERCIAL_SOURCE/);
  expect(
    await db.financeMilestoneInvoiceLink.count({
      where: { invoiceLineId: i.item.lines[0].id },
    }),
  ).toBe(0);
});
