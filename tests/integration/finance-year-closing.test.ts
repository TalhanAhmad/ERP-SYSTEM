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
  directory = `.local/finance/year-closing-${crypto.randomUUID()}`;
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
const { setupCommand } = await import("@/modules/finance/accounting/service"),
  { masterCommand } = await import("@/modules/finance/masters/service"),
  { invoiceCommand } = await import("@/modules/finance/receivables/service"),
  { billCommand } = await import("@/modules/finance/payables/service"),
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
  retained: string;
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
  retained = await account({
    type: "EQUITY",
    normalSide: "CREDIT",
    reportGroup: "EQUITY",
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
  yearCommand,
  yearPreview,
  yearHistory,
  yearDetail,
  yearReport,
  fiscalYears,
} = await import("@/modules/finance/year-closing/service");
const { closeCommand, closePreview } =
  await import("@/modules/finance/closing/service");
const { yearRead, yearMutation } =
  await import("@/modules/finance/year-closing/http");
let year: string;
async function cmd(
  action: Parameters<typeof yearCommand>[2],
  input: unknown,
  id = year,
  who = "owner",
  key = crypto.randomUUID(),
) {
  const v = await proof(who);
  return yearCommand(v.actor, v.proof, action, id, input, key);
}
async function closeInput(id = year) {
  const p = await yearPreview(people.owner, id);
  return {
    expectedVersion: p.year.version,
    basisHash: p.basisHash,
    postingFailuresReviewed: true,
    pendingAdjustmentsReviewed: true,
    postingReviewEvidence: "Reviewed synthetic failed posting attempts",
    adjustmentReviewEvidence: "Reviewed synthetic annual adjustments",
    reason: "Reviewed synthetic year close",
  };
}
async function reopenInput(id = year) {
  const h = await yearHistory(people.owner, id),
    c = await yearDetail(people.owner, id, h.items[0].id);
  return {
    closeId: c.id,
    expectedVersion: c.year.version,
    expectedCloseVersion: c.version,
    reason: "Authorized synthetic annual correction",
  };
}
it("creates an explicit year and previews exact income/expense transfer", async () => {
  year = (
    await cmd(
      "CREATE",
      {
        name: "Synthetic fiscal year",
        startDate: "2020-01-01",
        endDate: "2020-12-31",
        retainedAccountId: retained,
        evidence: "Reviewed synthetic calendar and mapping",
        reason: "Configure synthetic fiscal range",
      },
      undefined,
    )
  ).id;
  const p = await yearPreview(people.owner, year);
  expect(p.checklist.ready).toBe(true);
  expect(p.netProfit).toBe("40.01");
  expect(p.lines).toHaveLength(3);
  expect(p.lines.find((x) => x.accountId === retained)?.credit).toBe("40.01");
});
it("closes once, preserves P&L and balances equity without duplicate profit", async () => {
  const input = await closeInput(),
    key = crypto.randomUUID(),
    c = await cmd("CLOSE", input, year, "owner", key);
  expect(c.state).toBe("CLOSED");
  expect(await cmd("CLOSE", input, year, "owner", key)).toEqual(c);
  const h = await yearHistory(people.owner, year),
    d = await yearDetail(people.owner, year, h.items[0].id);
  expect(d.journalId).toBeTruthy();
  expect(d.netProfit).toBe("40.01");
  for (const stage of ["BEFORE", "AFTER"]) {
    const p = await yearReport(people.owner, year, d.id, "PROFIT_LOSS", stage);
    expect((p.summary.sections as Record<string, unknown>).netProfit).toBe(
      "40.01",
    );
  }
  const journal = await db.financeJournalEntry.findUniqueOrThrow({
    where: { id: d.journalId! },
    include: { lines: true },
  });
  expect(journal.sourceType).toBe("YEAR_CLOSE");
  expect(journal.lines).toHaveLength(3);
  const bs = await yearReport(
    people.owner,
    year,
    d.id,
    "BALANCE_SHEET",
    "AFTER",
  );
  expect(bs.summary.sections).toMatchObject({
    postedEquity: "40.01",
    unclosedProfit: "0.00",
    totalEquity: "40.01",
    difference: "0.00",
  });
});
it("reopens via an exact dated reversal and recloses as a new immutable cycle", async () => {
  const old = (await yearHistory(people.owner, year)).items[0],
    before = await yearReport(
      people.owner,
      year,
      old.id,
      "PROFIT_LOSS",
      "BEFORE",
    );
  const r = await cmd("REOPEN", await reopenInput());
  expect(r.state).toBe("OPEN");
  expect(r.reversalJournalId).toBeTruthy();
  const original = await db.financeJournalLine.findMany({
      where: { journalId: old.journalId! },
      orderBy: { sequence: "asc" },
    }),
    opposite = await db.financeJournalLine.findMany({
      where: { journalId: r.reversalJournalId! },
      orderBy: { sequence: "asc" },
    });
  expect(
    opposite.map((x) => [x.accountId, x.debit.toString(), x.credit.toString()]),
  ).toEqual(
    original.map((x) => [x.accountId, x.credit.toString(), x.debit.toString()]),
  );
  expect(
    await yearReport(people.owner, year, old.id, "PROFIT_LOSS", "BEFORE"),
  ).toMatchObject({ ...before, closeState: "REVERSED" });
  expect((await yearPreview(people.owner, year)).netProfit).toBe("40.01");
  const c = await cmd("CLOSE", await closeInput());
  expect(c.sequence).toBe(2);
  expect((await yearHistory(people.owner, year)).total).toBe(2);
});
it("blocks monthly reopen and ordinary posting until the annual reversal", async () => {
  const cp = await db.financePeriod.findUniqueOrThrow({
      where: { id: period },
    }),
    pc = await db.financePeriodClose.findFirstOrThrow({
      where: { periodId: period, state: "CLOSED" },
    }),
    v = await proof();
  await expect(
    closeCommand(
      v.actor,
      v.proof,
      "REOPEN",
      period,
      {
        closeId: pc.id,
        expectedVersion: cp.version,
        expectedCloseVersion: pc.version,
        reason: "Attempt unsafe monthly reopen",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_YEAR_REOPEN_REQUIRED" });
  await expect(
    sql.query(
      'INSERT INTO "FinanceJournalEntry"(id,reference,"sourceType","sourceId","sourceAction","postingDate","periodId",description,evidence,"postedById") VALUES($1,$2,\'YEAR_CLOSE\',$3,\'POST\',\'2020-12-31\',$4,\'Fiscal-year retained earnings transfer\',\'Forged source attempt\',$5)',
      [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        period,
        people.owner.id,
      ],
    ),
  ).rejects.toThrow();
});
it.each(["selected", "other", "hr", "lead", "member"])(
  "denies annual changes by %s",
  async (who) => {
    await expect(
      cmd("REOPEN", await reopenInput(), year, who),
    ).rejects.toMatchObject({
      code: who === "selected" ? "FINANCE_OWNER_REQUIRED" : "FINANCE_FORBIDDEN",
    });
    if (who !== "selected")
      await expect(yearPreview(people[who], year)).rejects.toMatchObject({
        code: "FINANCE_FORBIDDEN",
      });
  },
);
it("requires current versions, exact request content and one active close", async () => {
  const input = await reopenInput();
  await expect(
    cmd("REOPEN", { ...input, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await expect(
    cmd("REOPEN", { ...input, expectedCloseVersion: 99 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  const p = await yearPreview(people.owner, year);
  await expect(
    cmd("CLOSE", { ...(await closeInput()), expectedVersion: p.year.version }),
  ).rejects.toMatchObject({ code: "FINANCE_YEAR_STATE" });
});
async function adjustment(
  date: string,
  amount: string,
  creditAccount?: string,
) {
  const debitAccount = expense,
    offset = creditAccount ?? (await account()),
    v = await proof(),
    d = await ledgerCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        reference: "ADJ-" + crypto.randomUUID(),
        postingDate: date,
        description: "Synthetic actual annual adjustment",
        evidence: "Reviewed annual correcting evidence",
        lines: [
          {
            accountId: debitAccount,
            description: "Recognize adjustment cost",
            debit: amount,
            credit: "0.00",
            projectId: null,
          },
          {
            accountId: offset,
            description: "Recognize adjustment offset",
            debit: "0.00",
            credit: amount,
            projectId: null,
          },
        ],
        reason: "Reviewed synthetic adjustment",
      },
      crypto.randomUUID(),
    ),
    p = await proof();
  await ledgerCommand(
    p.actor,
    p.proof,
    "POST",
    {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post reviewed adjustment",
    },
    crypto.randomUUID(),
  );
}
it("supersedes exports on reopening, rejects a stale source, and transfers a real loss", async () => {
  const { exportCommand, exportDetail } =
      await import("@/modules/finance/reports/exports/service"),
    { processExport } =
      await import("@/modules/finance/reports/exports/worker"),
    v = await proof(),
    job = await exportCommand(
      v.actor,
      v.proof,
      "REQUEST",
      {
        reportType: "PROFIT_LOSS",
        filters: { from: "2020-01-01", to: "2020-12-31" },
        mode: "REVIEW",
        reason: "Synthetic retained pre-reopen report",
      },
      crypto.randomUUID(),
    );
  await processExport(job.id);
  expect((await exportDetail(people.owner, job.id)).state).toBe("READY");
  const input = await reopenInput(),
    key = crypto.randomUUID(),
    r = await cmd("REOPEN", input, year, "owner", key);
  expect(await cmd("REOPEN", input, year, "owner", key)).toEqual(r);
  await expect(
    cmd(
      "REOPEN",
      { ...input, reason: "Different authorized reason" },
      year,
      "owner",
      key,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  expect((await exportDetail(people.owner, job.id)).state).toBe("SUPERSEDED");
  const draftProof = await proof(),
    protectedDraft = await ledgerCommand(
      draftProof.actor,
      draftProof.proof,
      "CREATE",
      {
        reference: "Protected-" + crypto.randomUUID(),
        postingDate: "2020-12-31",
        description: "Attempt direct retained earnings posting",
        evidence: "Synthetic protected mapping test",
        lines: [
          {
            accountId: expense,
            description: "Attempt expense side",
            debit: "1.00",
            credit: "0.00",
            projectId: null,
          },
          {
            accountId: retained,
            description: "Attempt retained equity side",
            debit: "0.00",
            credit: "1.00",
            projectId: null,
          },
        ],
        reason: "Verify annual control isolation",
      },
      crypto.randomUUID(),
    );
  const postProof = await proof();
  await expect(
    ledgerCommand(
      postProof.actor,
      postProof.proof,
      "POST",
      {
        id: protectedDraft.id,
        expectedVersion: protectedDraft.version,
        reason: "Attempt direct retained posting",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_CONTROL_PROTECTED" });
  expect(
    await db.financeJournalEntry.count({
      where: { draftId: protectedDraft.id },
    }),
  ).toBe(0);
  const voidProof = await proof();
  await ledgerCommand(
    voidProof.actor,
    voidProof.proof,
    "VOID",
    {
      id: protectedDraft.id,
      expectedVersion: protectedDraft.version,
      reason: "Void rejected synthetic mapping attempt",
    },
    crypto.randomUUID(),
  );
  const stale = await closeInput();
  await adjustment("2020-12-31", "100.02");
  await expect(cmd("CLOSE", stale)).rejects.toMatchObject({
    code: "FINANCE_CLOSE_STALE",
  });
  const p = await yearPreview(people.owner, year);
  expect(p.netProfit).toBe("-60.01");
  expect(p.lines.find((x) => x.accountId === retained)?.debit).toBe("60.01");
  const c = await cmd("CLOSE", await closeInput());
  expect(c.sequence).toBe(3);
  const report = await yearReport(
    people.owner,
    year,
    c.closeId!,
    "PROFIT_LOSS",
    "AFTER",
  );
  expect((report.summary.sections as Record<string, unknown>).netProfit).toBe(
    "-60.01",
  );
});
let nextYear: string;
it("retains empty-year close without manufacturing a zero journal", async () => {
  await config("PERIOD_CREATE", {
    name: "Synthetic next year",
    startDate: "2021-01-01",
    endDate: "2021-12-31",
    reason: "Reviewed synthetic period",
  });
  nextYear = (
    await cmd("CREATE", {
      name: "Synthetic empty year",
      startDate: "2021-01-01",
      endDate: "2021-12-31",
      retainedAccountId: retained,
      evidence: "Reviewed synthetic annual mapping",
      reason: "Configure next synthetic year",
    })
  ).id;
  const p = await yearPreview(people.owner, nextYear);
  expect(p.checklist.ready).toBe(true);
  expect(p.lines).toEqual([]);
  const c = await cmd("CLOSE", await closeInput(nextYear), nextYear);
  expect(c.journalId).toBeNull();
  await expect(cmd("REOPEN", await reopenInput())).rejects.toMatchObject({
    code: "FINANCE_CLOSE_REOPEN_ORDER",
  });
});
it("closes gross income and expense even when net profit is exactly zero", async () => {
  await cmd("REOPEN", await reopenInput(nextYear), nextYear);
  await adjustment("2021-12-31", "100.00", revenue);
  const p = await yearPreview(people.owner, nextYear);
  expect(p.netProfit).toBe("0.00");
  expect(p.lines).toHaveLength(2);
  expect(p.lines.some((x) => x.accountId === retained)).toBe(false);
  const c = await cmd("CLOSE", await closeInput(nextYear), nextYear);
  expect(c.journalId).toBeTruthy();
});
let splitYear: string, firstPeriod: string;
it("blocks incomplete fiscal coverage, then accepts prior closed periods and final open period", async () => {
  firstPeriod = (
    await config("PERIOD_CREATE", {
      name: "Synthetic first half",
      startDate: "2022-01-01",
      endDate: "2022-06-30",
      reason: "Reviewed explicit half period",
    })
  ).id;
  splitYear = (
    await cmd("CREATE", {
      name: "Synthetic split year",
      startDate: "2022-01-01",
      endDate: "2022-12-31",
      retainedAccountId: retained,
      evidence: "Reviewed synthetic split calendar",
      reason: "Configure split fiscal year",
    })
  ).id;
  expect(
    (await yearPreview(people.owner, splitYear)).checklist
      .completePeriodCoverage,
  ).toBe(false);
  await expect(
    cmd("CLOSE", await closeInput(splitYear), splitYear),
  ).rejects.toMatchObject({ code: "FINANCE_CLOSE_INCOMPLETE" });
  await config("PERIOD_CREATE", {
    name: "Synthetic final half",
    startDate: "2022-07-01",
    endDate: "2022-12-31",
    reason: "Reviewed explicit half period",
  });
  const cp = await closePreview(people.owner, firstPeriod),
    v = await proof();
  await closeCommand(
    v.actor,
    v.proof,
    "CLOSE",
    firstPeriod,
    {
      ...(await closeInput(splitYear)),
      expectedVersion: cp.period.version,
      basisHash: cp.basisHash,
    },
    crypto.randomUUID(),
  );
  expect((await yearPreview(people.owner, splitYear)).checklist.ready).toBe(
    true,
  );
  expect(
    (await cmd("CLOSE", await closeInput(splitYear), splitYear)).state,
  ).toBe("CLOSED");
});
it("denies overlapping ranges, invalid equity mappings and unauthorized SQL mutation", async () => {
  const body = {
    name: "Invalid synthetic range",
    startDate: "2022-01-01",
    endDate: "2022-12-31",
    retainedAccountId: retained,
    evidence: "Reviewed synthetic range",
    reason: "Attempt duplicate configuration",
  };
  await expect(cmd("CREATE", body)).rejects.toMatchObject({
    code: "FINANCE_YEAR_OVERLAP",
  });
  await expect(
    cmd("CREATE", {
      ...body,
      startDate: "2030-01-01",
      endDate: "2030-12-31",
      retainedAccountId: ar,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVALID_INPUT" });
  for (const t of ["FinanceFiscalYear", "FinanceYearClose"]) {
    const result = await sql.query(
      "SELECT has_table_privilege('encova_app',$1,'INSERT') AS i,has_table_privilege('encova_app',$1,'UPDATE') AS u,has_table_privilege('encova_app',$1,'DELETE') AS d",
      ['"' + t + '"'],
    );
    expect(result.rows[0]).toEqual({ i: false, u: false, d: false });
  }
  for (const fn of [
    "encova_finance_year_emit(uuid,uuid,text)",
    "encova_finance_close_period_internal(uuid,text,text,timestamptz,text,jsonb,text,uuid)",
  ]) {
    expect(
      (
        await sql.query(
          "SELECT has_function_privilege('encova_app',$1,'EXECUTE') AS allowed",
          [fn],
        )
      ).rows[0].allowed,
    ).toBe(false);
  }
  await expect(
    sql.query(
      'UPDATE "FinanceYearClose" SET reason=\'Overwrite retained close\' WHERE "fiscalYearId"=$1',
      [year],
    ),
  ).rejects.toThrow("FINANCE_YEAR_RETAINED");
});
it("serves only current selected finance through private HTTP with Origin/feature guards", async () => {
  const path = "/api/v1/finance/fiscal-years",
    response = await yearRead(
      request("selected", undefined, crypto.randomUUID(), path),
      "LIST",
    );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await response.json()).data.total).toBe(3);
  for (const who of ["other", "hr", "lead", "member"])
    expect(
      (
        await yearRead(
          request(who, undefined, crypto.randomUUID(), path),
          "LIST",
        )
      ).status,
    ).toBe(403);
  const foreign = new Request(env.APP_URL + path, {
    method: "POST",
    headers: {
      origin: "https://foreign.example.test",
      "x-encova-csrf": "1",
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect((await yearMutation(foreign, "CREATE")).status).toBe(403);
  env.FINANCE_ENABLED = false;
  try {
    expect((await yearRead(request(), "LIST")).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});

it("rechecks revoked grants and stale provider evidence", async () => {
  const grant = await db.financeGrant.findFirstOrThrow({
    where: { userId: people.selected.id, revokedAt: null },
  });
  await db.financeGrant.update({
    where: { id: grant.id },
    data: {
      revokedAt: new Date(),
      revokedById: people.owner.id,
    },
  });
  await expect(yearHistory(people.selected, year)).rejects.toMatchObject({
    code: "FINANCE_FORBIDDEN",
  });
  await expect(
    sql.query(
      "SELECT encova_finance_year_command($1,'better-auth','expired',CURRENT_TIMESTAMP-interval '6 minutes','REOPEN',$2,$3,$4)",
      [
        people.owner.id,
        JSON.stringify({ ...(await reopenInput()), yearId: year }),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    ),
  ).rejects.toThrow("FINANCE_REAUTH_REQUIRED");
});
it("serializes concurrent annual closes and preserves a single permanent receipt", async () => {
  await config("PERIOD_CREATE", {
    name: "Synthetic concurrent year",
    startDate: "2023-01-01",
    endDate: "2023-12-31",
    reason: "Explicit concurrent test range",
  });
  const y = (
      await cmd("CREATE", {
        name: "Concurrent synthetic annual close",
        startDate: "2023-01-01",
        endDate: "2023-12-31",
        retainedAccountId: retained,
        evidence: "Reviewed synthetic calendar",
        reason: "Configure concurrent fixture",
      })
    ).id,
    input = await closeInput(y),
    key = crypto.randomUUID();
  const [a, b] = await Promise.all([
    cmd("CLOSE", input, y, "owner", key),
    cmd("CLOSE", input, y, "owner", key),
  ]);
  expect(a).toEqual(b);
  expect((await yearHistory(people.owner, y)).total).toBe(1);
  expect(
    await db.financeLedgerReceipt.count({
      where: { actorId: people.owner.id, operation: "YEAR_CLOSE", key },
    }),
  ).toBe(1);
});
it("blocks individual prior income/expense carryover even when net profit cancels to zero", async () => {
  const pid = (
    await config("PERIOD_CREATE", {
      name: "Prior unclosed income fixture",
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      reason: "Reviewed synthetic prior period",
    })
  ).id;
  await adjustment("2024-12-31", "0.01", revenue);
  const p = await closePreview(people.owner, pid),
    v = await proof();
  await closeCommand(
    v.actor,
    v.proof,
    "CLOSE",
    pid,
    {
      ...(await closeInput()),
      expectedVersion: p.period.version,
      basisHash: p.basisHash,
    },
    crypto.randomUUID(),
  );
  await config("PERIOD_CREATE", {
    name: "Following cutover year",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    reason: "Reviewed synthetic next period",
  });
  const y = (
    await cmd("CREATE", {
      name: "Unresolved synthetic cutover",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      retainedAccountId: retained,
      evidence: "Synthetic unclosed carryover test",
      reason: "Configure cutover review",
    })
  ).id;
  const preview = await yearPreview(people.owner, y);
  expect(preview.netProfit).toBe("0.00");
  expect(preview.checklist.priorUnclosedIncomeAccounts).toBe(2);
  expect(preview.checklist.ready).toBe(false);
  await expect(cmd("CLOSE", await closeInput(y), y)).rejects.toMatchObject({
    code: "FINANCE_CLOSE_INCOMPLETE",
  });
  const unused = (
    await cmd("CREATE", {
      name: "Unused synthetic void",
      startDate: "2031-01-01",
      endDate: "2031-12-31",
      retainedAccountId: retained,
      evidence: "Synthetic configuration correction",
      reason: "Prepare unused setup correction",
    })
  ).id;
  expect(
    (
      await cmd(
        "VOID",
        { expectedVersion: 1, reason: "Correct unused company calendar" },
        unused,
      )
    ).state,
  ).toBe("VOID");
});
it("paginates all explicit configurations and allows only unused voiding", async () => {
  for (let n = 0; n < 27; n++)
    await cmd("CREATE", {
      name: "Synthetic future " + n,
      startDate: `${2100 + n}-01-01`,
      endDate: `${2100 + n}-12-31`,
      retainedAccountId: retained,
      evidence: "Synthetic pagination calendar",
      reason: "Configure retained pagination fixture",
    });
  const first = await fiscalYears(people.owner),
    second = await fiscalYears(people.owner, { page: 2 });
  expect(first.total).toBe(33);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(8);
  expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(
    33,
  );
  const y = first.items[0];
  expect(
    (
      await cmd(
        "VOID",
        {
          expectedVersion: y.version,
          reason: "Correct unused synthetic setup",
        },
        y.id,
      )
    ).state,
  ).toBe("VOID");
  await expect(
    cmd("VOID", { expectedVersion: 7, reason: "Invalid used year void" }, year),
  ).rejects.toThrow();
});
