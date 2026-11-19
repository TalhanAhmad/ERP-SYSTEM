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
  directory = `.local/finance/closing-${crypto.randomUUID()}`;
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
const { exportCommand, exportDetail, exportDownload } =
    await import("@/modules/finance/reports/exports/service"),
  { processExport, processFinanceExports } =
    await import("@/modules/finance/reports/exports/worker"),
  { exportRead } = await import("@/modules/finance/reports/exports/http");
const { setupCommand } = await import("@/modules/finance/accounting/service"),
  { masterCommand } = await import("@/modules/finance/masters/service"),
  { invoiceCommand } = await import("@/modules/finance/receivables/service"),
  { billCommand } = await import("@/modules/finance/payables/service"),
  { reconciliationCommand } =
    await import("@/modules/finance/treasury/reconciliation/service"),
  { ledgerCommand } = await import("@/modules/finance/ledger/service");
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
const {
  closeCommand,
  closePreview,
  closeHistory,
  closeDetail,
  closeIssues,
  closeReport,
} = await import("@/modules/finance/closing/service");
const { closingRead, closingMutation } =
  await import("@/modules/finance/closing/http");
async function command(
  action: Parameters<typeof closeCommand>[2],
  pid: string,
  input: unknown,
  who = "owner",
  related?: string,
  key = crypto.randomUUID(),
) {
  const v = await proof(who);
  return closeCommand(v.actor, v.proof, action, pid, input, key, related);
}
async function close(pid = period) {
  const d = await closePreview(people.owner, pid);
  return command("CLOSE", pid, {
    expectedVersion: d.period.version,
    basisHash: d.basisHash,
    postingFailuresReviewed: true,
    pendingAdjustmentsReviewed: true,
    postingReviewEvidence:
      "Reviewed all synthetic failed posting attempts; no unresolved posting failure",
    adjustmentReviewEvidence:
      "Reviewed all synthetic period adjustments; none pending",
    reason: "Close reviewed synthetic period",
  });
}
async function reopen(id: string, pid = period) {
  const d = await closeDetail(people.owner, pid, id);
  return command("REOPEN", pid, {
    closeId: id,
    expectedVersion: d.period.version,
    expectedCloseVersion: d.version,
    reason: "Reopen synthetic period for explicit correction",
  });
}
let currentClose: string;
it("owner closes actual balanced noncash books with independent controls, complete reports and retained review evidence", async () => {
  const preview = await closePreview(people.owner, period);
  expect(preview.checklist.ready).toBe(true);
  expect(preview.reportRows).toMatchObject({ TRIAL_BALANCE: 4 });
  const result = await close();
  expect(result).toMatchObject({ state: "CLOSED", version: 2, sequence: 1 });
  currentClose = result.id;
  const d = await closeDetail(people.owner, period, result.id);
  expect(d.checklist).toMatchObject({
    ready: true,
    postingFailuresReviewed: true,
    pendingAdjustmentsReviewed: true,
  });
  const tb = await closeReport(
    people.owner,
    period,
    result.id,
    "TRIAL_BALANCE",
  );
  expect(tb.summary).toMatchObject({
    companyTotals: {
      periodDebit: "160.01",
      periodCredit: "160.01",
      periodDifference: "0.00",
    },
  });
  const pl = await closeReport(people.owner, period, result.id, "PROFIT_LOSS");
  expect(pl.summary).toMatchObject({ sections: { netProfit: "40.01" } });
  expect(tb.metadata.generatedAt).toBe(pl.metadata.generatedAt);
});
it("closed statements create fresh private export jobs from the exact retained snapshot after the period locks", async () => {
  const prior = await closeReport(
      people.owner,
      period,
      currentClose,
      "TRIAL_BALANCE",
    ),
    copy = await command(
      "EXPORT",
      period,
      { reportType: "TRIAL_BALANCE", reason: "Export original retained close" },
      "selected",
      currentClose,
    );
  await processExport(copy.id);
  const d = await exportDetail(people.selected, copy.id);
  expect(d).toMatchObject({ state: "READY", mode: "FINAL" });
  expect(d.metadata).toEqual(prior.metadata);
  expect(d.summary).toEqual(prior.summary);
  expect(d.items).toEqual(prior.items);
  expect(
    Buffer.from(
      (await exportDownload(people.selected, copy.id, "csv")).bytes,
    ).toString(),
  ).toContain(currentClose);
  finalId = copy.id;
});
it("closed periods reject actual dated source posting without changing balances", async () => {
  await expect(
    post("AR", "Blocked closed source", "5.00"),
  ).rejects.toMatchObject({ code: "FINANCE_PERIOD_UNAVAILABLE" });
  const d = await closeReport(
    people.owner,
    period,
    currentClose,
    "TRIAL_BALANCE",
  );
  expect(d.summary).toMatchObject({ companyTotals: { periodDebit: "160.01" } });
});
it("only current finance owner may close or reopen; grants and ordinary roles never imply ownership", async () => {
  const d = await closeDetail(people.owner, period, currentClose);
  await expect(
    command(
      "REOPEN",
      period,
      {
        closeId: currentClose,
        expectedVersion: d.period.version,
        expectedCloseVersion: d.version,
        reason: "Selected user cannot reopen",
      },
      "selected",
    ),
  ).rejects.toMatchObject({ status: 403, code: "FINANCE_OWNER_REQUIRED" });
  for (const who of ["hr", "lead", "member", "other"])
    await expect(closeHistory(people[who], period)).rejects.toMatchObject({
      status: 403,
    });
});
it("reopening retains the original reports, cancels queued copies and supersedes issued files", async () => {
  const original = await closeReport(
      people.owner,
      period,
      currentClose,
      "TRIAL_BALANCE",
    ),
    queued = await command(
      "EXPORT",
      period,
      { reportType: "PROFIT_LOSS", reason: "Retained queued close copy" },
      "owner",
      currentClose,
    );
  await reopen(currentClose);
  expect(
    (
      await db.financeReportExport.findUniqueOrThrow({
        where: { id: queued.id },
      })
    ).state,
  ).toBe("CANCELLED");
  expect(
    (await db.financeReportExport.findUniqueOrThrow({ where: { id: finalId } }))
      .state,
  ).toBe("SUPERSEDED");
  await expect(
    exportDownload(people.selected, finalId, "pdf"),
  ).rejects.toMatchObject({ code: "FINANCE_EXPORT_STATE" });
  expect(
    await closeReport(people.owner, period, currentClose, "TRIAL_BALANCE"),
  ).toMatchObject({
    closeState: "REOPENED",
    items: original.items,
    summary: original.summary,
  });
  await expect(
    command(
      "EXPORT",
      period,
      {
        reportType: "TRIAL_BALANCE",
        reason: "Cannot reissue a superseded close",
      },
      "owner",
      currentClose,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_CLOSE_STATE" });
});
it("pending source drafts and recorded failed posting/adjustment issues block a close", async () => {
  let p = await closePreview(people.owner, period);
  expect(p.checklist.pendingDrafts.total).toBe(1);
  await expect(close()).rejects.toMatchObject({
    code: "FINANCE_CLOSE_INCOMPLETE",
  });
  const draft = await db.financeInvoice.findFirstOrThrow({
      where: { state: "DRAFT", reference: "Blocked closed source" },
    }),
    v = await proof();
  await invoiceCommand(
    v.actor,
    v.proof,
    "VOID",
    {
      id: draft.id,
      expectedVersion: draft.version,
      reason: "Void refused synthetic source after review",
    },
    crypto.randomUUID(),
  );
  const issue = await command("ISSUE_CREATE", period, {
    kind: "POSTING_FAILURE",
    description: "Reviewed rejected closed posting remains unresolved",
    evidence: "Retained source and returned period failure",
    reason: "Record actual reviewed failed attempt",
  });
  p = await closePreview(people.owner, period);
  expect(p.checklist).toMatchObject({ ready: false, openReviewIssueCount: 1 });
  await expect(close()).rejects.toMatchObject({
    code: "FINANCE_CLOSE_INCOMPLETE",
  });
  await command(
    "ISSUE_RESOLVE",
    period,
    {
      expectedVersion: issue.version,
      resolution: "Voided the refused source and verified no ledger effect",
      reason: "Resolve original failed posting",
    },
    "owner",
    issue.id,
  );
  expect((await closePreview(people.owner, period)).checklist.ready).toBe(true);
});
it("closing requires reviewed current basis, both explicit owner confirmations and fresh versions", async () => {
  const p = await closePreview(people.owner, period),
    body = {
      expectedVersion: p.period.version,
      basisHash: p.basisHash,
      postingFailuresReviewed: true,
      pendingAdjustmentsReviewed: true,
      postingReviewEvidence: "Reviewed failed posting attempts",
      adjustmentReviewEvidence: "Reviewed pending adjustments",
      reason: "Reviewed close attempt",
    };
  await expect(
    command("CLOSE", period, { ...body, postingFailuresReviewed: false }),
  ).rejects.toBeInstanceOf(Error);
  await expect(
    command("CLOSE", period, { ...body, basisHash: "0".repeat(64) }),
  ).rejects.toMatchObject({ code: "FINANCE_CLOSE_STALE" });
  await expect(
    command("CLOSE", period, { ...body, expectedVersion: 999 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await post("AR", "Correction after owner reopen", "3.01");
  await expect(command("CLOSE", period, body)).rejects.toMatchObject({
    code: "FINANCE_CLOSE_STALE",
  });
  const c = await close();
  expect(c.sequence).toBe(2);
  currentClose = c.id;
  const history = await closeHistory(people.owner, period);
  expect(history.items.map((i) => i.state)).toEqual(["CLOSED", "REOPENED"]);
  expect(
    (await closeReport(people.owner, period, c.id, "PROFIT_LOSS")).summary,
  ).toMatchObject({ sections: { netProfit: "43.02" } });
});
it("close and reopen receipts remain idempotent and conflicting request bodies cannot reuse a key", async () => {
  const d = await closeDetail(people.owner, period, currentClose),
    key = crypto.randomUUID(),
    body = {
      closeId: currentClose,
      expectedVersion: d.period.version,
      expectedCloseVersion: d.version,
      reason: "Idempotent explicit owner reopen",
    };
  const first = await command("REOPEN", period, body, "owner", undefined, key);
  expect(
    await command("REOPEN", period, body, "owner", undefined, key),
  ).toEqual(first);
  await expect(
    command(
      "REOPEN",
      period,
      { ...body, reason: "Different request" },
      "owner",
      undefined,
      key,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  currentClose = (await close()).id;
});
it("later close ordering preserves cumulative statements and earlier periods reopen only after later cutoffs", async () => {
  const next = (
    await config("PERIOD_CREATE", {
      name: "Next actual synthetic reporting period",
      startDate: "2021-01-01",
      endDate: "2021-12-31",
      reason: "Retained next accounting period",
    })
  ).id;
  expect((await closePreview(people.owner, next)).checklist.ready).toBe(true);
  const c = await close(next);
  await expect(reopen(currentClose)).rejects.toMatchObject({
    code: "FINANCE_CLOSE_REOPEN_ORDER",
  });
  await reopen(c.id, next);
  await reopen(currentClose);
  expect(
    (await closePreview(people.owner, next)).checklist.priorOpenPeriods,
  ).toBe(1);
  await expect(close(next)).rejects.toMatchObject({
    code: "FINANCE_CLOSE_INCOMPLETE",
  });
  currentClose = (await close()).id;
});
it("a worker claimed before reopen cannot publish after its period is reopened", async () => {
  const job = await command(
      "EXPORT",
      period,
      {
        reportType: "BALANCE_SHEET",
        reason: "Original saved statement worker",
      },
      "owner",
      currentClose,
    ),
    claim = (
      await sql.query("SELECT encova_finance_export_claim($1) AS data", [
        job.id,
      ])
    ).rows[0].data;
  expect(claim.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  await reopen(currentClose);
  expect(
    (
      await sql.query(
        "SELECT encova_finance_export_finish($1,$2,$3,$4,$5,NULL) AS done",
        [
          job.id,
          claim.leaseId,
          claim.snapshotHash,
          Buffer.from("Synthetic CSV"),
          Buffer.from("%PDF-synthetic"),
        ],
      )
    ).rows[0].done,
  ).toBe(false);
  expect(
    (await db.financeReportExport.findUniqueOrThrow({ where: { id: job.id } }))
      .state,
  ).toBe("CANCELLED");
  currentClose = (await close()).id;
});
it("saved source and issue history reject direct deletion and mutation; runtime cannot bypass checked interfaces", async () => {
  await expect(
    sql.query(
      'UPDATE "FinancePeriod" SET state=\'OPEN\',"closedAt"=NULL,"closedById"=NULL,version=version+1 WHERE id=$1',
      [period],
    ),
  ).rejects.toMatchObject({ message: "FINANCE_PERIOD_STATE" });
  await expect(
    sql.query('DELETE FROM "FinancePeriodClose" WHERE id=$1', [currentClose]),
  ).rejects.toMatchObject({ message: "FINANCE_CLOSE_RETAINED" });
  await expect(
    sql.query('UPDATE "FinancePeriodClose" SET reports=$2 WHERE id=$1', [
      currentClose,
      {},
    ]),
  ).rejects.toMatchObject({ message: "FINANCE_CLOSE_RETAINED" });
  const rows = (
    await sql.query(
      `SELECT has_table_privilege('encova_app','"FinancePeriodClose"','UPDATE') AS write,has_table_privilege('encova_app','"FinanceCloseIssue"','INSERT') AS insert,has_function_privilege('encova_app','encova_finance_close_pack(uuid,uuid)','EXECUTE') AS raw`,
    )
  ).rows[0];
  expect(rows).toEqual({ write: false, insert: false, raw: false });
  const grant = (
    await sql.query(
      `SELECT has_function_privilege('public','encova_finance_close_command(uuid,text,text,timestamp with time zone,text,jsonb,text,uuid)','EXECUTE') AS allowed`,
    )
  ).rows[0];
  expect(grant.allowed).toBe(false);
});
it("a closed cutoff protects earlier dates and new earlier ranges as well as its own period", async () => {
  await expect(
    config("PERIOD_CREATE", {
      name: "Cannot create an earlier live posting range",
      startDate: "2019-01-01",
      endDate: "2019-12-31",
      reason: "Attempt below issued close cutoff",
    }),
  ).rejects.toBeInstanceOf(Error);
  await expect(
    sql.query("SELECT encova_finance_close_assert_open(DATE '2019-12-31')"),
  ).rejects.toMatchObject({ message: "FINANCE_PERIOD_UNAVAILABLE" });
  await sql.query("SELECT encova_finance_close_assert_open(DATE '2021-01-01')");
});
it("authenticated close reads remain private, deny nonfinance roles and enforce fresh mutation shape and Origin", async () => {
  const response = await closingRead(request("owner"), "HISTORY", period);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await response.json()).data.items.length).toBeGreaterThan(0);
  for (const who of ["other", "hr", "lead", "member"])
    expect(
      (await closingRead(request(who), "DETAIL", period, currentClose)).status,
    ).toBe(403);
  expect(
    (
      await closingRead(
        new Request(
          env.APP_URL + "/api/v1/finance/periods/" + period + "/closes",
        ),
        "HISTORY",
        period,
      )
    ).status,
  ).toBe(401);
  const invalid = await closingMutation(
    request("owner", {
      expectedVersion: 1,
      basisHash: "0".repeat(64),
      postingFailuresReviewed: false,
      pendingAdjustmentsReviewed: true,
      postingReviewEvidence: "Actual owner review",
      adjustmentReviewEvidence: "Actual owner review",
      reason: "Bad confirmation",
      reauth: { password },
    }),
    "CLOSE",
    period,
  );
  expect(invalid.status).toBe(422);
  const badOrigin = request("owner", {
    reason: "Bad origin",
    reauth: { password },
  });
  badOrigin.headers.set("origin", "https://different.example.test");
  expect((await closingMutation(badOrigin, "REOPEN", period)).status).toBe(403);
});
it("retained reports and private jobs require current role and original export grant epoch", async () => {
  const job = await command(
    "EXPORT",
    period,
    { reportType: "TRIAL_BALANCE", reason: "Current authorized snapshot copy" },
    "selected",
    currentClose,
  );
  await db.person.update({
    where: { id: people.selected.id },
    data: { status: "INACTIVE" },
  });
  await expect(
    closeDetail(people.selected, period, currentClose),
  ).rejects.toMatchObject({ status: 403 });
  await processExport(job.id);
  expect(
    (await db.financeReportExport.findUniqueOrThrow({ where: { id: job.id } }))
      .state,
  ).toBe("CANCELLED");
  await db.person.update({
    where: { id: people.selected.id },
    data: { status: "ACTIVE" },
  });
});
it("close versus source posting serializes so a reviewed cutoff cannot admit an unreviewed concurrent posting", async () => {
  await reopen(currentClose);
  for (const order of ["CLOSE_FIRST", "POST_FIRST"]) {
    const p = await closePreview(people.owner, period),
      body = {
        expectedVersion: p.period.version,
        basisHash: p.basisHash,
        postingFailuresReviewed: true,
        pendingAdjustmentsReviewed: true,
        postingReviewEvidence: "Reviewed all actual synthetic posting failures",
        adjustmentReviewEvidence: "Reviewed all actual adjustments",
        reason: "Concurrent close review",
      },
      reference = "Concurrent " + order;
    const actions =
      order === "CLOSE_FIRST"
        ? [
            () => command("CLOSE", period, body),
            () => post("AR", reference, "1.01"),
          ]
        : [
            () => post("AR", reference, "1.01"),
            () => command("CLOSE", period, body),
          ];
    const results = await Promise.allSettled(actions.map((fn) => fn()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const p2 = await db.financePeriod.findUniqueOrThrow({
      where: { id: period },
    });
    if (p2.state === "CLOSED") {
      const c = await db.financePeriodClose.findFirstOrThrow({
        where: { periodId: period, state: "CLOSED" },
      });
      await reopen(c.id);
    }
    const draft = await db.financeInvoice.findFirst({
      where: { reference, state: "DRAFT" },
    });
    if (draft) {
      const v = await proof();
      await invoiceCommand(
        v.actor,
        v.proof,
        "VOID",
        {
          id: draft.id,
          expectedVersion: draft.version,
          reason: "Void the actual refused concurrent source",
        },
        crypto.randomUUID(),
      );
    }
    expect((await closePreview(people.owner, period)).checklist.ready).toBe(
      true,
    );
  }
  currentClose = (await close()).id;
});
it("a missing bank proof blocks closing even if other control balances and book totals tie", async () => {
  await reopen(currentClose);
  const cash = await account({ controlType: "CASH" });
  bank = (
    await master("CASH_CREATE", {
      name: "Actual pending bank proof",
      kind: "BANK",
      glAccountId: cash,
      reason: "Explicit source for close review",
    })
  ).id;
  const p = await closePreview(people.owner, period);
  expect(p.checklist).toMatchObject({
    ready: false,
    readiness: { banks: { missing: 1 } },
  });
  await expect(close()).rejects.toMatchObject({
    code: "FINANCE_CLOSE_INCOMPLETE",
  });
  const v = await proof(),
    review = await reconciliationCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        mode: "ZERO_ACTIVITY",
        cashAccountId: bank,
        startDate: "2020-01-01",
        cutoffDate: "2020-12-31",
        openingBalance: "0.00",
        closingBalance: "0.00",
        evidence: "Reviewed original genuine no-activity bank",
        reason: "Record genuine synthetic bank review",
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
      reason: "Finalize bank proof at exact period end",
    },
    crypto.randomUUID(),
  );
  currentClose = (await close()).id;
});
it("bank evidence cannot reopen below a retained period close", async () => {
  const r = await db.financeReconciliation.findFirstOrThrow({
      where: { cashAccountId: bank, state: "FINALIZED" },
    }),
    v = await proof();
  await expect(
    reconciliationCommand(
      v.actor,
      v.proof,
      "REOPEN",
      {
        id: r.id,
        expectedVersion: r.version,
        reason: "Cannot invalidate bank evidence beneath an issued close",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_PERIOD_UNAVAILABLE" });
  expect(
    (
      await db.financePeriodClose.findUniqueOrThrow({
        where: { id: currentClose },
      })
    ).state,
  ).toBe("CLOSED");
});
it("a disabled feature hides close routes, private report views and mutations", async () => {
  env.FINANCE_ENABLED = false;
  try {
    await expect(closeHistory(people.owner, period)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await closingRead(request(), "DETAIL", period, currentClose)).status,
    ).toBe(404);
    expect(
      (
        await closingMutation(
          request("owner", { reauth: { password } }),
          "REOPEN",
          period,
        )
      ).status,
    ).toBe(404);
    await processFinanceExports();
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("reopening supersedes ordinary later-range copies whose opening balances depend on the corrected period", async () => {
  const copy = await ask({
    ...base,
    filters: { from: "2021-01-01", to: "2021-01-31" },
  });
  await processExport(copy.id);
  const before = await exportDetail(people.owner, copy.id);
  expect(before.state).toBe("READY");
  await reopen(currentClose);
  const after = await exportDetail(people.owner, copy.id);
  expect(after.state).toBe("SUPERSEDED");
  expect(after.snapshotHash).toBe(before.snapshotHash);
  expect(after.csvHash).toBe(before.csvHash);
  expect((await exportRead(request(), copy.id, "csv")).status).toBe(409);
  currentClose = (await close()).id;
});
it("saved reports page all original account rows and preserve values across later master-name changes", async () => {
  await reopen(currentClose);
  const ids: string[] = [];
  for (let n = 0; n < 27; n++)
    ids.push(await account({ name: "Saved source dimension " + n }));
  let v = await proof();
  const draft = await ledgerCommand(
    v.actor,
    v.proof,
    "CREATE",
    {
      reference: "Actual independent close pagination",
      description: "Actual noncash journal for report pagination",
      evidence: "Reviewed original source lines",
      postingDate: "2020-01-15",
      currency: "PKR",
      lines: [
        ...ids.map((id) => ({
          accountId: id,
          description: "Ordinary asset source",
          debit: "1.00",
          credit: "0.00",
          projectId: null,
        })),
        {
          accountId: revenue,
          description: "Earned noncash consideration",
          debit: "0.00",
          credit: "27.00",
          projectId: null,
        },
      ],
      reason: "Record actual source for report pages",
    },
    crypto.randomUUID(),
  );
  v = await proof();
  await ledgerCommand(
    v.actor,
    v.proof,
    "POST",
    {
      id: draft.id,
      expectedVersion: draft.version,
      reason: "Post reviewed actual source",
    },
    crypto.randomUUID(),
  );
  currentClose = (await close()).id;
  const first = await closeReport(
      people.owner,
      period,
      currentClose,
      "TRIAL_BALANCE",
    ),
    second = await closeReport(
      people.owner,
      period,
      currentClose,
      "TRIAL_BALANCE",
      { page: 2 },
    );
  expect(first.total).toBe(31);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(6);
  const original = (
    await db.financeAccount.findUniqueOrThrow({ where: { id: ids[0] } })
  ).name;
  await sql.query('UPDATE "FinanceAccount" SET name=$2 WHERE id=$1', [
    ids[0],
    "Later legitimate master display name",
  ]);
  const report = await closeReport(
    people.owner,
    period,
    currentClose,
    "TRIAL_BALANCE",
  );
  expect(report.items).toEqual(first.items);
  expect([...first.items, ...second.items]).toContainEqual(
    expect.objectContaining({ name: original }),
  );
});
it("review issue pagination retains all unresolved items and no first-page limit can permit closing", async () => {
  await reopen(currentClose);
  for (let n = 0; n < 27; n++)
    await command("ISSUE_CREATE", period, {
      kind: "PENDING_ADJUSTMENT",
      description: "Pending reviewed adjustment " + n,
      evidence: "Original nonposting review item " + n,
      reason: "Record required original review",
    });
  const first = await closeIssues(people.owner, period),
    second = await closeIssues(people.owner, period, { page: 2 }),
    preview = await closePreview(people.owner, period);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(3);
  expect(first.total).toBe(28);
  expect(preview.checklist.openReviewIssueCount).toBe(27);
  expect(preview.checklist.reviewIssues).toHaveLength(25);
  await expect(close()).rejects.toMatchObject({
    code: "FINANCE_CLOSE_INCOMPLETE",
  });
});
