import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import pg from "pg";
// A separate, fully owned database proves final readiness without deleting the regression database's retained books.
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const url = `postgresql://encova:local_only@localhost:${port}/encova_test`,
  directory = `.local/finance/exports-${crypto.randomUUID()}`;
process.env.DATABASE_URL = url;
process.env.TEST_DATABASE_URL = url;
process.env.FINANCE_ENABLED = "true";
const local = new EmbeddedPostgres({
  databaseDir: directory,
  user: "encova",
  password: "local_only",
  port,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const { db } = await import("@/server/db"),
  { env } = await import("@/server/env");
const { verifyFinanceReauthentication } =
    await import("@/modules/finance/access/reauth"),
  { setupOwner } = await import("@/modules/finance/access/service");
const { exportCommand, exportRegister, exportDetail, exportDownload } =
    await import("@/modules/finance/reports/exports/service"),
  { processExport, processFinanceExports } =
    await import("@/modules/finance/reports/exports/worker"),
  { exportRead, exportMutation } =
    await import("@/modules/finance/reports/exports/http");
const { setupCommand } = await import("@/modules/finance/accounting/service"),
  { masterCommand } = await import("@/modules/finance/masters/service"),
  { invoiceCommand } = await import("@/modules/finance/receivables/service"),
  { billCommand } = await import("@/modules/finance/payables/service"),
  { reconciliationCommand } =
    await import("@/modules/finance/treasury/reconciliation/service"),
  { planningCommand } = await import("@/modules/finance/planning/service");
const sql = new pg.Client({ connectionString: url }),
  password = "Export-synthetic-only-9#",
  people: Record<string, Awaited<ReturnType<typeof db.person.create>>> = {},
  cookies: Record<string, string> = {};
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const request = (
  who = "owner",
  body?: unknown,
  key = crypto.randomUUID(),
  path = "/api/v1/finance/exports",
) =>
  new Request(env.APP_URL + path, {
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
  verifyFinanceReauthentication(request(who), { password });
const base = {
  reportType: "TRIAL_BALANCE",
  filters: { from: "2020-01-01", to: "2020-01-31" },
  mode: "REVIEW",
  reason: "Synthetic authorized report export",
};
async function ask(
  body: unknown = base,
  who = "owner",
  key = crypto.randomUUID(),
) {
  const v = await proof(who);
  return exportCommand(v.actor, v.proof, "REQUEST", body, key);
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
let period: string;
let n = 0,
  ar: string,
  revenue: string,
  ap: string,
  expense: string,
  bank: string,
  finalId: string;
async function account(patch: Record<string, unknown> = {}) {
  return (
    await config("ACCOUNT_CREATE", {
      code: "EX38." + ++n,
      name: "Export account " + n,
      type: "ASSET",
      normalSide: "DEBIT",
      reportGroup: "CURRENT_ASSETS",
      controlType: "NONE",
      currency: "PKR",
      parentId: null,
      isPosting: true,
      isContra: false,
      isCashEquivalent: false,
      reason: "Reviewed synthetic report mapping",
      ...patch,
    })
  ).id;
}
async function post(side: "AR" | "AP", reference: string, amount: string) {
  const party = await master("PARTY_CREATE", {
      name: reference,
      legalName: "Synthetic Legal Co",
      kind: side === "AR" ? "CLIENT" : "SUPPLIER",
      reason: "Synthetic source identity",
    }),
    v = await proof();
  const data = {
    reference,
    partyId: party.id,
    ...(side === "AR"
      ? { receivableAccountId: ar, invoiceDate: "2020-01-01" }
      : { kind: "BILL", payableAccountId: ap, billDate: "2020-01-01" }),
    postingDate: "2020-01-01",
    dueDate: "2020-01-10",
    description: "Real synthetic posted service",
    evidence: "Reviewed synthetic source",
    lines: [
      {
        description: "Service",
        quantity: "1",
        unitRate: amount,
        ...(side === "AR"
          ? { recognition: "EARNED", revenueAccountId: revenue }
          : { treatment: "EXPENSE", costAccountId: expense }),
      },
    ],
    reason: "Recognize original synthetic source",
  };
  const d =
    side === "AR"
      ? await invoiceCommand(
          v.actor,
          v.proof,
          "CREATE",
          data,
          crypto.randomUUID(),
        )
      : await billCommand(
          v.actor,
          v.proof,
          "CREATE",
          data,
          crypto.randomUUID(),
        );
  const next = await proof();
  await (side === "AR" ? invoiceCommand : billCommand)(
    next.actor,
    next.proof,
    "POST",
    {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post real synthetic source",
    },
    crypto.randomUUID(),
  );
  return d;
}
beforeAll(async () => {
  env.FINANCE_ENABLED = true;
  await local.initialise();
  await local.start();
  await local.createDatabase("encova_test");
  execFileSync("pnpm", ["db:migrate:deploy"], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
    timeout: 90000,
  });
  await sql.connect();
  await sql.query(await readFile("supabase/setup.sql", "utf8"));
  for (const [name, role] of [
    ["owner", "SUPER_ADMIN"],
    ["selected", "SUPER_ADMIN"],
    ["other", "SUPER_ADMIN"],
    ["hr", "HR_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
  ] as const) {
    const email = "export." + name + "@example.test",
      identity = await auth.api.signUpEmail({
        body: { name, email, password },
      });
    await db.user.update({
      where: { id: identity.user.id },
      data: { emailVerified: true },
    });
    people[name] = await db.person.create({
      data: {
        authUserId: identity.user.id,
        email,
        username: "export." + name,
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
  const v = await proof();
  await setupOwner(
    v.actor,
    v.proof,
    people.owner.username,
    "Explicit synthetic owner",
  );
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "Explicit synthetic selected access",
    },
  });
  period = (
    await config("PERIOD_CREATE", {
      name: "Synthetic export period",
      startDate: "2020-01-01",
      endDate: "2020-12-31",
      reason: "Reviewed synthetic period",
    })
  ).id;
  ar = await account({ controlType: "RECEIVABLES" });
  revenue = await account({
    type: "INCOME",
    normalSide: "CREDIT",
    reportGroup: "REVENUE",
  });
  ap = await account({
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "PAYABLES",
  });
  expense = await account({
    type: "OPERATING_EXPENSE",
    reportGroup: "OPERATING_EXPENSES",
  });
  await post("AR", "Original income", "100.01");
  await post("AP", "Original cost", "60.00");
}, 120000);
afterAll(async () => {
  await db.$disconnect();
  await sql.end();
  await local.stop();
  await rm(directory, { recursive: true, force: true });
}, 30000);
it("final copies pass on real balanced noncash books, with complete control proofs and private artifacts", async () => {
  const job = await ask({ ...base, mode: "FINAL" });
  await processExport(job.id);
  const d = await exportDetail(people.owner, job.id);
  expect(d.state, d.errorCode ?? undefined).toBe("READY");
  expect(d.readiness?.finalEligible).toBe(true);
  expect(d.summary).toMatchObject({
    companyTotals: {
      periodDebit: "160.01",
      periodCredit: "160.01",
      periodDifference: "0.00",
    },
  });
  expect(d.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  const csv = await exportDownload(people.owner, job.id, "csv"),
    pdf = await exportDownload(people.owner, job.id, "pdf");
  expect(Buffer.from(csv.bytes).toString()).toContain("160.01");
  expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe("%PDF-");
  finalId = job.id;
});
it("queued execution cannot resurrect a revoked grant even after a new grant is issued", async () => {
  const job = await ask(base, "selected"),
    grant = await db.financeGrant.findFirstOrThrow({
      where: { userId: people.selected.id, revokedAt: null },
    });
  await db.financeGrant.delete({ where: { id: grant.id } });
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "New explicitly selected grant",
    },
  });
  await processExport(job.id);
  expect(
    (await db.financeReportExport.findUniqueOrThrow({ where: { id: job.id } }))
      .state,
  ).toBe("CANCELLED");
  await expect(exportDetail(people.selected, job.id)).rejects.toMatchObject({
    status: 404,
  });
});
it("request replay is permanent and conflicting filters cannot reuse its key", async () => {
  const key = crypto.randomUUID(),
    job = await ask(base, "owner", key);
  expect(await ask(base, "owner", key)).toEqual(job);
  await expect(
    ask({ ...base, mode: "FINAL" }, "owner", key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
});
it("every supported report freezes the same canonical dataset and normalized filters", async () => {
  const cases: [string, Record<string, string>][] = [
    ["GENERAL_LEDGER", { ...base.filters, accountId: ar }],
    ["PROFIT_LOSS", base.filters],
    ["BALANCE_SHEET", { asOf: "2020-01-31" }],
    ["CASH_FLOW", base.filters],
    ["RECEIVABLES_AGEING", { asOf: "2020-01-31" }],
    ["PAYABLES_AGEING", { asOf: "2020-01-31" }],
    ["ROLL_FORWARD", { ...base.filters, kind: "ADVANCES" }],
    ["BUDGET_VARIANCE", { month: "2020-01", projectId: "SHARED" }],
  ];
  for (const [reportType, filters] of cases) {
    const job = await ask({ ...base, reportType, filters });
    await processExport(job.id);
    const d = await exportDetail(people.owner, job.id);
    expect(d.state, reportType + ":" + d.errorCode).toBe("READY");
    expect(d.metadata).toMatchObject({
      currency: "PKR",
      basis: "POSTED_ACCRUAL",
    });
    expect(d.filters).toMatchObject(filters);
  }
}, 30000);
it("missing bank reconciliation blocks final copies even when display filters hide all rows", async () => {
  const cash = await account({ controlType: "CASH" });
  bank = (
    await master("CASH_CREATE", {
      name: "Synthetic bank",
      kind: "BANK",
      glAccountId: cash,
      reason: "Actual registered synthetic bank",
    })
  ).id;
  const job = await ask({
    ...base,
    mode: "FINAL",
    filters: { ...base.filters, q: "no-matching-row" },
  });
  await processExport(job.id);
  const d = await exportDetail(people.owner, job.id);
  expect(d.state).toBe("FAILED");
  expect(d.errorCode).toBe("FINANCE_EXPORT_INCOMPLETE");
  expect(d.snapshotHash).toBeNull();
  expect(d.failureDetails).toMatchObject({
    finalEligible: false,
    banks: { missing: 1 },
  });
  await expect(
    exportDownload(people.owner, job.id, "pdf"),
  ).rejects.toMatchObject({ code: "FINANCE_EXPORT_STATE" });
});
it("only an actual finalized bank review at the exact cutoff clears the bank gate", async () => {
  const v = await proof(),
    review = await reconciliationCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        mode: "ZERO_ACTIVITY",
        cashAccountId: bank,
        startDate: "2020-01-01",
        cutoffDate: "2020-01-31",
        openingBalance: "0.00",
        closingBalance: "0.00",
        evidence: "Genuine synthetic bank with no activity",
        reason: "Review actual no-activity statement",
      },
      crypto.randomUUID(),
    );
  const next = await proof();
  await reconciliationCommand(
    next.actor,
    next.proof,
    "FINALIZE",
    {
      id: review.id,
      expectedVersion: review.version,
      reason: "Finalize genuine zero-activity review",
    },
    crypto.randomUUID(),
  );
  const job = await ask({ ...base, mode: "FINAL" });
  await processExport(job.id);
  expect(await exportDetail(people.owner, job.id)).toMatchObject({
    state: "READY",
    readiness: { finalEligible: true, banks: { missing: 0 } },
  });
  const later = await ask({
    ...base,
    mode: "FINAL",
    filters: { from: "2020-01-01", to: "2020-02-01" },
  });
  await processExport(later.id);
  expect((await exportDetail(people.owner, later.id)).state).toBe("FAILED");
});
it("review copies visibly retain incomplete diagnostics instead of fabricating readiness", async () => {
  const job = await ask({
    ...base,
    filters: { from: "2020-01-01", to: "2020-02-01" },
  });
  await processExport(job.id);
  const d = await exportDetail(people.owner, job.id);
  expect(d).toMatchObject({
    state: "READY",
    mode: "REVIEW",
    readiness: { finalEligible: false },
  });
  const csv = await exportDownload(people.owner, job.id, "csv");
  expect(Buffer.from(csv.bytes).toString()).toContain("INCOMPLETE");
});
it("captured rows, totals, policy and artifact hashes remain frozen after later postings", async () => {
  const prior = await exportDetail(people.owner, finalId),
    before = await exportDownload(people.owner, finalId, "csv");
  await post("AR", "Later ordinary source", "3.01");
  const after = await exportDetail(people.owner, finalId),
    bytes = await exportDownload(people.owner, finalId, "csv");
  expect(after.snapshotHash).toBe(prior.snapshotHash);
  expect(after.summary).toEqual(prior.summary);
  expect(bytes.bytes).toEqual(before.bytes);
});
it("exports retain all filtered rows past page one with matching frozen totals", async () => {
  for (let i = 0; i < 27; i++)
    await account({
      name: i === 26 ? "=Formula account" : "Page account " + i,
    });
  const job = await ask({
    ...base,
    filters: { ...base.filters, includeZero: "YES" },
  });
  await processExport(job.id);
  const d = await exportDetail(people.owner, job.id),
    page2 = await exportDetail(people.owner, job.id, { page: 2 });
  expect(d.rowCount).toBeGreaterThan(25);
  expect(d.items).toHaveLength(25);
  expect(page2.items.length).toBeGreaterThan(0);
  const csv = Buffer.from(
    (await exportDownload(people.owner, job.id, "csv")).bytes,
  ).toString();
  expect(csv).toContain("'=Formula account");
  expect(csv).toContain("Page account 25");
}, 30000);
it("current selected users can only download their own export; the current owner may review it", async () => {
  const job = await ask(base, "selected");
  await processExport(job.id);
  expect((await exportDetail(people.owner, job.id)).canMutate).toBe(false);
  await expect(
    exportDownload(people.selected, finalId, "csv"),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    exportDownload(people.other, job.id, "csv"),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (await exportDownload(people.owner, job.id, "pdf")).bytes.length,
  ).toBeGreaterThan(100);
});
it("execution and completion recheck role/grant; a stale lease cannot publish or overwrite a retained artifact", async () => {
  const job = await ask(base, "selected"),
    claim = (
      await sql.query("SELECT encova_finance_export_claim($1) AS data", [
        job.id,
      ])
    ).rows[0].data;
  expect(claim.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  expect(
    (
      await sql.query("SELECT encova_finance_export_claim($1) AS data", [
        job.id,
      ])
    ).rows[0].data,
  ).toBeNull();
  const finish = () =>
    sql.query(
      "SELECT encova_finance_export_finish($1,$2,$3,$4,$5,NULL) AS data",
      [
        job.id,
        claim.leaseId,
        claim.snapshotHash,
        Buffer.from("CSV"),
        Buffer.from("%PDF-test"),
      ],
    );
  await db.person.update({
    where: { id: people.selected.id },
    data: { role: "MEMBER" },
  });
  expect((await finish()).rows[0].data).toBe(false);
  await db.person.update({
    where: { id: people.selected.id },
    data: { role: "SUPER_ADMIN" },
  });
  expect((await finish()).rows[0].data).toBe(false);
  expect(
    (await db.financeReportExport.findUniqueOrThrow({ where: { id: job.id } }))
      .state,
  ).toBe("CANCELLED");
});
it("download checks the current requester epoch and current role after a copy was already prepared", async () => {
  const job = await ask(base, "selected");
  await processExport(job.id);
  await db.person.update({
    where: { id: people.selected.id },
    data: { status: "INACTIVE" },
  });
  await expect(
    exportDownload(people.owner, job.id, "pdf"),
  ).rejects.toMatchObject({ status: 404 });
  await db.person.update({
    where: { id: people.selected.id },
    data: { status: "ACTIVE" },
  });
  const grant = await db.financeGrant.findFirstOrThrow({
    where: { userId: people.selected.id, revokedAt: null },
  });
  await db.financeGrant.delete({ where: { id: grant.id } });
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "New distinct grant epoch",
    },
  });
  await expect(
    exportDownload(people.selected, job.id, "pdf"),
  ).rejects.toMatchObject({ status: 404 });
});
it("cancel and retry are versioned fresh-authorized nonposting operations with bounded attempts", async () => {
  const job = await ask(base);
  let v = await proof();
  await expect(
    exportCommand(
      v.actor,
      v.proof,
      "CANCEL",
      { id: job.id, expectedVersion: 99, reason: "Cancel synthetic request" },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  v = await proof();
  await exportCommand(
    v.actor,
    v.proof,
    "CANCEL",
    {
      id: job.id,
      expectedVersion: job.version,
      reason: "Cancel synthetic request",
    },
    crypto.randomUUID(),
  );
  await processExport(job.id);
  expect((await exportDetail(people.owner, job.id)).state).toBe("CANCELLED");
  const failed = await ask({
    ...base,
    mode: "FINAL",
    filters: { from: "2020-01-01", to: "2020-02-01" },
  });
  await processExport(failed.id);
  const d = await exportDetail(people.owner, failed.id);
  v = await proof();
  await exportCommand(
    v.actor,
    v.proof,
    "RETRY",
    {
      id: failed.id,
      expectedVersion: d.version,
      reason: "Recheck corrected sources",
    },
    crypto.randomUUID(),
  );
  await processExport(failed.id);
  await processExport(failed.id);
  expect((await exportDetail(people.owner, failed.id)).attempts).toBe(3);
  await processExport(failed.id);
  expect((await exportDetail(people.owner, failed.id)).attempts).toBe(3);
});
it("raw snapshot deletion, source mutation and artifact replacement are blocked even for a trusted SQL caller", async () => {
  await expect(
    sql.query('DELETE FROM "FinanceReportExport" WHERE id=$1', [finalId]),
  ).rejects.toMatchObject({ message: "FINANCE_EXPORT_RETAINED" });
  await expect(
    sql.query(
      'UPDATE "FinanceReportExport" SET filters=$2,version=version+1 WHERE id=$1',
      [finalId, {}],
    ),
  ).rejects.toMatchObject({ message: "FINANCE_EXPORT_RETAINED" });
  await expect(
    sql.query(
      'UPDATE "FinanceReportExport" SET csv=$2,version=version+1 WHERE id=$1',
      [finalId, Buffer.from("changed")],
    ),
  ).rejects.toMatchObject({ message: "FINANCE_EXPORT_RETAINED" });
});
it("runtime SQL role cannot call raw report capture or mutate retained exports; public roles have no access", async () => {
  for (const r of ["encova_app", "public"]) {
    const p = (
      await sql.query(
        "SELECT has_function_privilege($1,'encova_finance_export_capture(uuid,text,jsonb,text)','EXECUTE') AS allowed",
        [r],
      )
    ).rows[0];
    expect(p.allowed).toBe(false);
  }
  const p = (
    await sql.query(
      `SELECT has_table_privilege('encova_app','"FinanceReportExport"','UPDATE') AS allowed`,
    )
  ).rows[0];
  expect(p.allowed).toBe(false);
});
it("private HTTP responses enforce roles, authenticated downloads and cache controls", async () => {
  const response = await exportRead(
    request(
      "owner",
      undefined,
      undefined,
      `/api/v1/finance/exports/${finalId}/csv`,
    ),
    finalId,
    "csv",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  for (const who of ["hr", "lead", "member", "other"]) {
    expect((await exportRead(request(who), finalId, "pdf")).status).toBe(403);
    expect((await exportRead(request(who))).status).toBe(403);
  }
  expect(
    (await exportRead(new Request(env.APP_URL + "/api/v1/finance/exports")))
      .status,
  ).toBe(401);
  const invalid = await exportMutation(
    request("owner", {
      ...base,
      filters: { ...base.filters, page: 1 },
      reauth: { password },
    }),
    "REQUEST",
  );
  expect(invalid.status).toBe(422);
});
it("a disabled feature blocks requests, workers and downloads without touching live books", async () => {
  env.FINANCE_ENABLED = false;
  try {
    await expect(exportRegister(people.owner)).rejects.toMatchObject({
      status: 404,
    });
    await expect(processExport(finalId)).rejects.toMatchObject({ status: 404 });
    expect((await exportRead(request(), finalId, "pdf")).status).toBe(404);
    await processFinanceExports();
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("a final budget export requires the actual approved revision and retains advisory variance", async () => {
  const body = {
      ...base,
      reportType: "BUDGET_VARIANCE",
      filters: { month: "2020-01", projectId: "SHARED" },
      mode: "FINAL",
    },
    missing = await ask(body);
  await processExport(missing.id);
  expect(await exportDetail(people.owner, missing.id)).toMatchObject({
    state: "FAILED",
    failureDetails: { approvedBudgetAvailable: false },
  });
  let v = await proof();
  const plan = await planningCommand(
    v.actor,
    v.proof,
    "BUDGET_CREATE",
    {
      month: "2020-01",
      projectId: null,
      description: "Actual synthetic approved expense plan",
      evidence: "Reviewed budget policy for synthetic scenario",
      lines: [{ accountId: expense, amount: "50.00" }],
      reason: "Create reviewed synthetic budget",
    },
    crypto.randomUUID(),
  );
  v = await proof();
  await planningCommand(
    v.actor,
    v.proof,
    "BUDGET_APPROVE",
    {
      id: plan.id,
      expectedVersion: plan.version,
      approvalEvidence: "Owner reviewed synthetic budget",
      reason: "Approve actual synthetic version",
    },
    crypto.randomUUID(),
  );
  const job = await ask(body);
  await processExport(job.id);
  const d = await exportDetail(people.owner, job.id);
  expect(d).toMatchObject({
    state: "READY",
    summary: { advisoryOnly: true, budget: { id: plan.id, version: 2 } },
    readiness: { approvedBudgetAvailable: true },
  });
  expect(d.items).toContainEqual(
    expect.objectContaining({
      budget: "50.00",
      actual: "60.00",
      remaining: "-10.00",
      exceeded: true,
    }),
  );
});
it("leases bound expired worker recovery and a different worker cannot finish a live claim", async () => {
  const job = await ask(base),
    claim = (
      await sql.query("SELECT encova_finance_export_claim($1) AS data", [
        job.id,
      ])
    ).rows[0].data;
  expect(
    (
      await sql.query(
        "SELECT encova_finance_export_finish($1,$2,$3,$4,$5,NULL) AS data",
        [
          job.id,
          crypto.randomUUID(),
          claim.snapshotHash,
          Buffer.from("CSV"),
          Buffer.from("%PDF-test"),
        ],
      )
    ).rows[0].data,
  ).toBe(false);
  // Controlled nonposting job timestamps simulate three already-expired worker attempts.
  const exhausted = await ask(base);
  for (let n = 1; n <= 3; n++)
    await sql.query(
      `UPDATE "FinanceReportExport" SET state='RUNNING',attempts=$2,version=version+1,"leaseId"=$3,"leaseUntil"=now()-interval '1 second' WHERE id=$1`,
      [exhausted.id, n, crypto.randomUUID()],
    );
  await processExport(exhausted.id);
  expect(await exportDetail(people.owner, exhausted.id)).toMatchObject({
    state: "FAILED",
    attempts: 3,
    errorCode: "FINANCE_EXPORT_ATTEMPTS",
  });
});
it("expired jobs cannot execute or download and their original request timestamps cannot be extended", async () => {
  const id = crypto.randomUUID(),
    grant = await db.financeGrant.findFirstOrThrow({
      where: { userId: people.owner.id, revokedAt: null },
    });
  await sql.query(
    `INSERT INTO "FinanceReportExport"(id,"requesterId","requesterGrantId","reportType",filters,mode,reason,"createdAt","expiresAt") VALUES($1,$2,$3,'TRIAL_BALANCE',$4,'REVIEW','Controlled expired nonposting request',now()-interval '25 hours',now()-interval '1 hour')`,
    [
      id,
      people.owner.id,
      grant.id,
      { ...base.filters, q: "", includeZero: "NO" },
    ],
  );
  await processExport(id);
  expect(await exportDetail(people.owner, id)).toMatchObject({
    state: "CANCELLED",
    expired: true,
    errorCode: "EXPORT_EXPIRED",
  });
  await expect(exportDownload(people.owner, id, "csv")).rejects.toMatchObject({
    code: "FINANCE_EXPORT_STATE",
  });
  await expect(
    sql.query(
      'UPDATE "FinanceReportExport" SET "expiresAt"=now()+interval \'24 hours\',version=version+1 WHERE id=$1',
      [id],
    ),
  ).rejects.toMatchObject({ message: "FINANCE_EXPORT_RETAINED" });
});
it("the full row bound rejects oversized filtered datasets without discarding rows", async () => {
  await sql.query("BEGIN");
  try {
    await sql.query(
      `INSERT INTO "FinanceAccount"(id,code,name,type,"normalSide","reportGroup","controlType",currency,"isPosting","isContra","isCashEquivalent",active,version,"updatedAt") SELECT gen_random_uuid(),'LIMIT38.'||n,'Bounded export row '||n,'ASSET','DEBIT','CURRENT_ASSETS','NONE','PKR',true,false,false,true,1,now() FROM generate_series(1,2001) n`,
    );
    await expect(
      sql.query(
        `SELECT encova_finance_export_capture($1,'TRIAL_BALANCE',$2,'REVIEW')`,
        [
          people.owner.id,
          { ...base.filters, q: "LIMIT38.", includeZero: "YES" },
        ],
      ),
    ).rejects.toMatchObject({ message: "FINANCE_EXPORT_LIMIT" });
  } finally {
    await sql.query("ROLLBACK");
  }
});
it("unregistered real capitalized costs block final issuance while original frozen copies stay intact", async () => {
  const asset = await account({
      controlType: "FIXED_ASSET",
      reportGroup: "NONCURRENT_ASSETS",
    }),
    party = await master("PARTY_CREATE", {
      name: "Synthetic asset supplier",
      legalName: "Synthetic Legal Co",
      kind: "SUPPLIER",
      reason: "Synthetic asset source identity",
    });
  let v = await proof();
  const bill = await billCommand(
    v.actor,
    v.proof,
    "CREATE",
    {
      kind: "BILL",
      reference: "Unregistered synthetic asset",
      partyId: party.id,
      payableAccountId: ap,
      billDate: "2020-01-01",
      postingDate: "2020-01-01",
      dueDate: "2020-01-10",
      description: "Actual synthetic capitalized source",
      evidence: "Reviewed source awaiting asset registration",
      lines: [
        {
          description: "Synthetic equipment",
          quantity: "1",
          unitRate: "25.00",
          treatment: "ASSET",
          costAccountId: asset,
        },
      ],
      reason: "Post actual capitalized source",
    },
    crypto.randomUUID(),
  );
  v = await proof();
  await billCommand(
    v.actor,
    v.proof,
    "POST",
    {
      id: bill.id,
      expectedVersion: bill.version,
      reason: "Recognize actual equipment source",
    },
    crypto.randomUUID(),
  );
  const job = await ask({
    ...base,
    mode: "FINAL",
    filters: { ...base.filters, q: "invisible" },
  });
  await processExport(job.id);
  expect(await exportDetail(people.owner, job.id)).toMatchObject({
    state: "FAILED",
    failureDetails: {
      finalEligible: false,
      rollforwards: { ASSETS: { ready: false } },
    },
  });
  expect(
    (await exportDownload(people.owner, finalId, "pdf")).bytes.length,
  ).toBeGreaterThan(100);
});

it("export processing never closes or rewrites the configured accounting period", async () => {
  expect(
    await db.financePeriod.findUniqueOrThrow({ where: { id: period } }),
  ).toMatchObject({ state: "OPEN" });
});
