import "dotenv/config";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import pg from "pg";
import { createHash } from "node:crypto";
// Multi-command report/close/reversal workflows take more than five seconds on CI.
// Bound only this file; retain every assertion and all production timeouts.
vi.setConfig({ testTimeout: 30_000 });
// A separate, fully owned database proves final readiness without deleting the regression database's retained books.
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const url = `postgresql://encova:local_only@localhost:${port}/encova_test`,
  directory = `.local/finance/opening-${crypto.randomUUID()}`;
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
  { masterCommand } = await import("@/modules/finance/masters/service");
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
let n = 0;
const accounts: Record<string, string> = {};
let client: string,
  supplier: string,
  contributor: string,
  bank: string,
  loanIn: string,
  loanOut: string,
  holding: string;
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
beforeAll(async () => {
  env.FINANCE_ENABLED = true;
  await local.initialise();
  await local.start();
  await local.createDatabase("encova_test");
  await sql.connect();
  await sql.query(
    "CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT",
  );
  execFileSync("pnpm", ["db:migrate:deploy"], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: "pipe",
    timeout: 90000,
  });
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
  await config("PERIOD_CREATE", {
    name: "Synthetic export period",
    startDate: "2020-01-01",
    endDate: "2020-12-31",
    reason: "Reviewed synthetic period",
  });

  const A = async (name: string, patch: Record<string, unknown> = {}) =>
    (accounts[name] = await account(patch));
  await A("clearing", {
    type: "EQUITY",
    normalSide: "CREDIT",
    reportGroup: "EQUITY",
    controlType: "OPENING_CLEARING",
  });
  await A("retained", {
    type: "EQUITY",
    normalSide: "CREDIT",
    reportGroup: "EQUITY",
  });
  await A("ar", { controlType: "RECEIVABLES" });
  await A("cash", { controlType: "CASH", isCashEquivalent: true });
  await A("ordinary");
  await A("ap", {
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "PAYABLES",
  });
  await A("loanR", { controlType: "LOAN_RECEIVABLE" });
  await A("interestR", { controlType: "INTEREST_RECEIVABLE" });
  await A("loanP", {
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "LOAN_PAYABLE",
  });
  await A("interestP", {
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "INTEREST_PAYABLE",
  });
  await A("investment", { controlType: "INVESTMENT" });
  await A("investmentIncome", { controlType: "INVESTMENT_INCOME_RECEIVABLE" });
  await A("asset", {
    controlType: "FIXED_ASSET",
    reportGroup: "NONCURRENT_ASSETS",
  });
  await A("accumulated", {
    controlType: "ACCUMULATED_DEPRECIATION",
    reportGroup: "NONCURRENT_ASSETS",
    isContra: true,
    normalSide: "CREDIT",
  });
  await A("supplierAdvance", { controlType: "SUPPLIER_ADVANCE" });
  await A("clientAdvance", {
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "CLIENT_ADVANCE",
  });
  await A("deferred", {
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "DEFERRED_REVENUE",
  });
  await A("capital", {
    type: "EQUITY",
    normalSide: "CREDIT",
    reportGroup: "EQUITY",
    controlType: "CAPITAL",
  });
  await A("distribution", {
    type: "EQUITY",
    normalSide: "CREDIT",
    reportGroup: "EQUITY",
    controlType: "DISTRIBUTION",
  });
  await A("founder", {
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "FOUNDER_PAYABLE",
  });
  await A("tax", { controlType: "TAX_INPUT" });
  await A("income", {
    type: "OTHER_INCOME",
    normalSide: "CREDIT",
    reportGroup: "OTHER_INCOME",
  });
  await A("revenue", {
    type: "INCOME",
    normalSide: "CREDIT",
    reportGroup: "REVENUE",
  });
  await A("expense", {
    type: "OTHER_EXPENSE",
    normalSide: "DEBIT",
    reportGroup: "OTHER_EXPENSES",
  });
  client = (
    await master("PARTY_CREATE", {
      name: "Legacy client",
      legalName: "Synthetic Client",
      kind: "CLIENT",
      reason: "Reviewed synthetic opening master",
    })
  ).id;
  supplier = (
    await master("PARTY_CREATE", {
      name: "Legacy supplier",
      legalName: "Synthetic Supplier",
      kind: "SUPPLIER",
      reason: "Reviewed synthetic opening master",
    })
  ).id;
  contributor = (
    await master("PARTY_CREATE", {
      name: "Legacy contributor",
      legalName: "Synthetic Contributor",
      kind: "OTHER",
      reason: "Reviewed synthetic opening master",
    })
  ).id;
  bank = (
    await master("CASH_CREATE", {
      name: "Synthetic cutover bank",
      kind: "BANK",
      glAccountId: accounts.cash,
      currency: "PKR",
      reason: "Reviewed synthetic cash mapping",
    })
  ).id;
  const { loanCommand } =
      await import("@/modules/finance/funding/loans/service"),
    { holdingCommand } = await import("@/modules/finance/investments/service");
  for (const direction of ["RECEIVED", "ADVANCED"]) {
    const v = await proof(),
      d = await loanCommand(
        v.actor,
        v.proof,
        "CREATE",
        {
          name: "Synthetic legacy " + direction,
          partyId: contributor,
          direction,
          startDate: "2019-01-01",
          maturityDate: "2030-12-31",
          agreedPrincipal: "100.00",
          agreement: "Reviewed original synthetic agreement",
          principalAccountId:
            direction === "RECEIVED" ? accounts.loanP : accounts.loanR,
          interestAccountId:
            direction === "RECEIVED" ? accounts.interestP : accounts.interestR,
          interestResultAccountId:
            direction === "RECEIVED" ? accounts.expense : accounts.income,
          reason: "Review synthetic opening terms",
        },
        crypto.randomUUID(),
      );
    if (direction === "RECEIVED") loanIn = d.id;
    else loanOut = d.id;
  }
  const vh = await proof();
  holding = (
    await holdingCommand(
      vh.actor,
      vh.proof,
      "CREATE",
      {
        name: "Synthetic legacy holding",
        partyId: contributor,
        investmentType: "Synthetic fund",
        unitMode: "UNIT",
        classification: "CURRENT",
        policyStatus: "REVIEWED",
        measurementMode: "MANUAL_VALUATION",
        valuationOffsetAccountId: accounts.income,
        valuationTreatment: "PROFIT_LOSS",
        policy: "Reviewed historical carrying amount and cost basis",
        evidence: "Synthetic policy acceptance",
        investmentAccountId: accounts.investment,
        gainAccountId: accounts.income,
        lossAccountId: accounts.expense,
        feeAccountId: accounts.expense,
        incomeAccountId: accounts.income,
        incomeControlAccountId: accounts.investmentIncome,
        impairmentAccountId: accounts.expense,
        reason: "Reviewed synthetic legacy position",
      },
      crypto.randomUUID(),
    )
  ).id;
}, 120000);
afterAll(async () => {
  vi.resetConfig();
  await db.$disconnect();
  await sql.end();
  await local.stop();
  await rm(directory, { recursive: true, force: true });
}, 30000);

const {
  openingCommand,
  openingPreview,
  openingDetail,
  openingLines,
  openingSource,
} = await import("@/modules/finance/opening/service");
async function cmd(
  action: Parameters<typeof openingCommand>[2],
  body: unknown,
  id?: string,
  who = "owner",
  key = crypto.randomUUID(),
) {
  const v = await proof(who);
  return openingCommand(v.actor, v.proof, action, id, body, key);
}
function source() {
  const tb = (key: string, debit: string, credit = "0.00") => ({
      accountId: accounts[key],
      debit,
      credit,
    }),
    item = (
      kind: string,
      key: string,
      amount: string,
      patch: Record<string, unknown> = {},
    ) => ({
      kind,
      accountId: accounts[key],
      amount,
      reference: kind + key,
      originalDate: "2019-01-01",
      description: "Reviewed synthetic legacy " + kind,
      ...patch,
    });
  return {
    formatVersion: 1,
    name: "Reviewed synthetic opening",
    currency: "PKR",
    cutoverDate: "2020-01-01",
    clearingAccountId: accounts.clearing,
    evidence: "Actual synthetic legacy file and reconciliation review",
    trialBalance: [
      tb("ar", "100.00"),
      tb("cash", "200.00"),
      tb("loanR", "30.00"),
      tb("interestR", "10.00"),
      tb("investment", "80.00"),
      tb("investmentIncome", "3.00"),
      tb("asset", "100.00"),
      tb("accumulated", "0.00", "20.00"),
      tb("supplierAdvance", "12.00"),
      tb("tax", "4.00"),
      tb("ordinary", "5.00"),
      tb("distribution", "10.00"),
      tb("ap", "0.00", "60.00"),
      tb("loanP", "0.00", "40.00"),
      tb("interestP", "0.00", "5.00"),
      tb("clientAdvance", "0.00", "25.00"),
      tb("deferred", "0.00", "16.00"),
      tb("founder", "0.00", "15.00"),
      tb("capital", "0.00", "50.00"),
      tb("retained", "0.00", "323.00"),
    ],
    items: [
      item("AR", "ar", "100.00", { partyId: client, dueDate: "2019-12-01" }),
      item("AP", "ap", "60.00", { partyId: supplier, dueDate: "2019-12-10" }),
      item("CASH", "cash", "200.00", { cashAccountId: bank }),
      item("LOAN_PRINCIPAL", "loanR", "30.00", { loanId: loanOut }),
      item("LOAN_INTEREST", "interestR", "10.00", { loanId: loanOut }),
      item("LOAN_PRINCIPAL", "loanP", "40.00", { loanId: loanIn }),
      item("LOAN_INTEREST", "interestP", "5.00", { loanId: loanIn }),
      item("INVESTMENT", "investment", "80.00", {
        holdingId: holding,
        costBasis: "70.00",
        units: "2.500000",
      }),
      item("INVESTMENT_INCOME", "investmentIncome", "3.00", {
        holdingId: holding,
      }),
      item("ASSET", "asset", "100.00", {
        secondaryAccountId: accounts.accumulated,
        accumulatedDepreciation: "20.00",
        tag: "OPEN-ASSET",
        location: "Synthetic office",
        inServiceDate: "2019-01-01",
        remainingLifeMonths: 80,
        residualValue: "0.00",
        firstDepMonth: "2020-01",
        policyEvidence: "Reviewed remaining eighty months from cutover",
      }),
      item("CAPITAL", "capital", "50.00", { partyId: contributor }),
      item("DISTRIBUTION", "distribution", "10.00", { partyId: contributor }),
      item("FOUNDER_PAYABLE", "founder", "15.00", { partyId: contributor }),
      item("CLIENT_ADVANCE", "clientAdvance", "25.00", { partyId: client }),
      item("SUPPLIER_ADVANCE", "supplierAdvance", "12.00", {
        partyId: supplier,
      }),
      item("DEFERRED", "deferred", "16.00", {
        partyId: client,
        resultAccountId: accounts.revenue,
        receivableAccountId: accounts.ar,
      }),
    ],
  };
}
let batch: string;
const stageKey = crypto.randomUUID();
it("stages a reviewed file without posting and previews every control exactly", async () => {
  const created = await cmd(
    "CREATE",
    {
      fileName: "reviewed-opening.json",
      sourceText: JSON.stringify(source()),
      reason: "Stage actual synthetic legacy file",
    },
    undefined,
    "owner",
    stageKey,
  );
  batch = created.id;
  expect(await db.financeJournalEntry.count()).toBe(0);
  const p = await openingPreview(people.owner, batch);
  expect(p).toMatchObject({
    ready: true,
    balanced: true,
    debits: "554.00",
    credits: "554.00",
    mappingIssueCount: 0,
  });
  expect(p.controls.every((x) => x.ready)).toBe(true);
  expect((await openingLines(people.owner, batch)).total).toBe(36);
});

async function stage(value: unknown) {
  return cmd("CREATE", {
    fileName: "reviewed-opening.json",
    sourceText: JSON.stringify(value),
    reason: "Stage reviewed negative test source",
  });
}
it("requires reviewed liability presentation for an imported bank overdraft", async () => {
  const value = source();
  const cash = value.items.find((x) => x.kind === "CASH")!;
  Object.assign(cash, { side: "CREDIT" });
  const tb = value.trialBalance.find((x) => x.accountId === accounts.cash)!;
  Object.assign(tb, { debit: "0.00", credit: "200.00" });
  const retained = value.trialBalance.find(
    (x) => x.accountId === accounts.retained,
  )!;
  Object.assign(retained, { debit: "77.00", credit: "0.00" });
  const draft = await stage(value),
    preview = await openingPreview(people.owner, draft.id);
  expect(preview).toMatchObject({
    balanced: true,
    ready: false,
    mappingIssueCount: 1,
  });
  expect(preview.issues.some((x) => x.code === "FINANCE_OPENING_MAPPING")).toBe(
    true,
  );
  expect(await db.financeJournalEntry.count()).toBe(0);
  await cmd(
    "VOID",
    {
      expectedVersion: draft.version,
      reason: "Retain unreviewed overdraft source",
    },
    draft.id,
  );
});
it("replays exact file and request keys while retaining the original bytes", async () => {
  const original = await openingSource(people.owner, batch);
  expect(original.sourceText).toBe(JSON.stringify(source()));
  expect(original.sourceHash).toBe(
    createHash("sha256").update(original.sourceText).digest("hex"),
  );
  const duplicate = await cmd("CREATE", {
    fileName: "another-name.json",
    sourceText: original.sourceText,
    reason: "Review exact repeated source file",
  });
  expect(duplicate.id).toBe(batch);
  await expect(
    cmd(
      "CREATE",
      {
        fileName: "different.json",
        sourceText: original.sourceText,
        reason: "Stage actual synthetic legacy file",
      },
      undefined,
      "owner",
      stageKey,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
});
it("blocks unbalanced trial balances without leaving source documents or journals", async () => {
  const body = source();
  body.name += " unbalanced";
  body.trialBalance.at(-1)!.credit = "322.00";
  const b = await stage(body),
    p = await openingPreview(people.owner, b.id);
  expect(p.ready).toBe(false);
  expect(p.balanced).toBe(false);
  await expect(
    cmd(
      "POST",
      {
        expectedVersion: p.version,
        basisHash: p.basisHash,
        reviewEvidence: "Review observed imbalance",
        reason: "Attempt incomplete opening",
      },
      b.id,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_OPENING_INCOMPLETE" });
  expect(await db.financeInvoice.count()).toBe(0);
  expect(await db.financeJournalEntry.count()).toBe(0);
  expect(
    (
      await cmd(
        "VOID",
        { expectedVersion: 1, reason: "Retain failed source and correct file" },
        b.id,
      )
    ).state,
  ).toBe("VOIDED");
  expect((await openingSource(people.owner, b.id)).sourceText).toBe(
    JSON.stringify(body),
  );
});
it("requires detailed control totals and valid deferred-revenue mappings", async () => {
  const body = source();
  body.name += " missing AR";
  body.items[0].amount = "99.99";
  const b = await stage(body),
    p = await openingPreview(people.owner, b.id);
  expect(p.ready).toBe(false);
  expect(p.controls.find((x) => x.accountId === accounts.ar)).toMatchObject({
    difference: "-0.01",
    ready: false,
  });
  const wrong = source();
  wrong.name += " wrong deferred map";
  (wrong.items.at(-1)! as Record<string, unknown>).resultAccountId =
    accounts.expense;
  const w = await stage(wrong),
    preview = await openingPreview(people.owner, w.id);
  expect(preview.mappingIssueCount).toBe(1);
  expect(preview.ready).toBe(false);
});
it("rejects foreign currencies, unsafe money and unknown source fields", async () => {
  for (const patch of [
    { currency: "USD" },
    { exchangeRate: "1.00" },
    { formatVersion: 2 },
  ])
    await expect(stage({ ...source(), ...patch })).rejects.toThrow();
  const body = source();
  body.items[0].amount = 0.1 as unknown as string;
  await expect(stage(body)).rejects.toThrow();
  expect(await db.financeJournalEntry.count()).toBe(0);
  const session = (
    await sql.query(
      'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
      [people.owner.authUserId],
    )
  ).rows[0];
  await expect(
    sql.query(
      "SELECT encova_finance_opening_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'CREATE',$3,$4,$5)",
      [
        people.owner.id,
        session.id,
        JSON.stringify({
          fileName: "foreign.json",
          sourceText: JSON.stringify({ ...source(), currency: "USD" }),
          reason: "Explicit invalid source test",
        }),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    ),
  ).rejects.toThrow("FINANCE_INVALID_INPUT");
});
it.each(["selected", "other", "hr", "lead", "member"])(
  "denies opening mutations by %s",
  async (who) => {
    await expect(
      cmd(
        "VOID",
        { expectedVersion: 1, reason: "Attempt unauthorized source change" },
        batch,
        who,
      ),
    ).rejects.toMatchObject({
      code: who === "selected" ? "FINANCE_OWNER_REQUIRED" : "FINANCE_FORBIDDEN",
    });
  },
);
it("requires a fresh basis after source mappings change", async () => {
  const body = source();
  body.name += " stale map";
  const b = await stage(body),
    preview = await openingPreview(people.owner, b.id),
    a = await db.financeAccount.findUniqueOrThrow({
      where: { id: accounts.ordinary },
    });
  await config("ACCOUNT_UPDATE", {
    id: a.id,
    expectedVersion: a.version,
    code: a.code,
    name: "Reviewed renamed opening account",
    type: a.type,
    normalSide: a.normalSide,
    reportGroup: a.reportGroup,
    controlType: a.controlType,
    currency: a.currency,
    parentId: a.parentId,
    isPosting: a.isPosting,
    isContra: a.isContra,
    isCashEquivalent: a.isCashEquivalent,
    reason: "Review changed opening classification label",
  });
  await expect(
    cmd(
      "POST",
      {
        expectedVersion: preview.version,
        basisHash: preview.basisHash,
        reviewEvidence: "Reviewed old preview",
        reason: "Attempt stale opening source",
      },
      b.id,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_OPENING_STALE" });
  expect(await db.financeJournalEntry.count()).toBe(0);
});
it("keeps runtime tables read-only and raw opening emitters private", async () => {
  for (const t of [
    "FinanceOpeningBatch",
    "FinanceOpeningLine",
    "FinanceOpeningPosting",
  ]) {
    const r = (
      await sql.query(
        "SELECT has_table_privilege('encova_app',$1,'INSERT') AS i,has_table_privilege('encova_app',$1,'UPDATE') AS u,has_table_privilege('encova_app',$1,'DELETE') AS d",
        ['"' + t + '"'],
      )
    ).rows[0];
    expect(r).toEqual({ i: false, u: false, d: false });
  }
  for (const fn of [
    "encova_finance_opening_emit(uuid,uuid)",
    "encova_finance_opening_prepare_source(uuid,uuid)",
    "encova_finance_opening_finish_source(uuid,uuid,uuid)",
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
});
it("posts all typed positions and trial balance once with zero clearing", async () => {
  const p = await openingPreview(people.owner, batch);
  const result = await cmd(
    "POST",
    {
      expectedVersion: p.version,
      basisHash: p.basisHash,
      reviewEvidence:
        "Reviewed original file, due dates, control totals and zero clearing proof",
      reason: "Post reviewed synthetic cutover",
    },
    batch,
  );
  expect(result.state).toBe("POSTED");
  const d = await openingDetail(people.owner, batch);
  expect(d.proof).toMatchObject({ ready: true, clearingBalance: "0.00" });
  expect(await db.financeInvoice.count({ where: { state: "POSTED" } })).toBe(2);
  expect(await db.financeBill.count({ where: { state: "POSTED" } })).toBe(1);
});

it("reconciles original subledgers and reports with cash treated as an opening position", async () => {
  const lines = (
    await sql.query(
      `SELECT id,kind FROM "FinanceOpeningLine" WHERE "batchId"=$1 AND kind<>'TB' ORDER BY sequence`,
      [batch],
    )
  ).rows;
  const ar = lines.find((x) => x.kind === "AR")!,
    deferred = lines.find((x) => x.kind === "DEFERRED")!;
  expect(
    (
      await db.financeReceivableEvent.aggregate({
        where: { invoiceId: ar.id },
        _sum: { amount: true },
      })
    )._sum.amount!.toFixed(2),
  ).toBe("100.00");
  expect(
    await db.financeReceivableEvent.count({
      where: { invoiceId: deferred.id },
    }),
  ).toBe(0);
  expect(
    (
      await sql.query(
        `SELECT * FROM encova_finance_asset_position($1,'2020-01-01')`,
        [lines.find((x) => x.kind === "ASSET")!.id],
      )
    ).rows[0],
  ).toMatchObject({ cost: "100.00", depreciation: "20.00", carrying: "80.00" });
  expect(
    (
      await sql.query(
        "SELECT encova_finance_asset_charge($1,'2020-01') AS amount",
        [lines.find((x) => x.kind === "ASSET")!.id],
      )
    ).rows[0].amount,
  ).toMatch(/^1(?:[.]0+)?$/);
  const cash = (
    await sql.query(
      "SELECT encova_finance_cash_flow_report('2020-01-01','2020-01-01','',1) AS data",
    )
  ).rows[0].data;
  expect(cash).toMatchObject({
    openingBalance: "200.00",
    closingBalance: "200.00",
    externalNet: "0.00",
    difference: "0.00",
    classificationReady: true,
    unclassifiedCount: 0,
  });
});
it("prevents another cutover and all earlier financial posting", async () => {
  const next = source();
  next.name += " repeated cutover";
  const b = await stage(next),
    p = await openingPreview(people.owner, b.id);
  expect(p.ready).toBe(false);
  expect(p.ledgerEmpty).toBe(false);
  await expect(
    sql.query("SELECT encova_finance_close_assert_open('2019-12-31')"),
  ).rejects.toThrow("FINANCE_OPENING_DATE");
  await expect(
    sql.query(
      `UPDATE "FinanceOpeningBatch" SET "sourceText"='{}' WHERE id=$1`,
      [batch],
    ),
  ).rejects.toThrow();
  await expect(
    sql.query('DELETE FROM "FinanceOpeningLine" WHERE "batchId"=$1', [batch]),
  ).rejects.toThrow();
  expect(
    (await openingDetail(people.owner, batch)).proof?.clearingBalance,
  ).toBe("0.00");
});
it("serves paged private retained sources and rechecks role/feature access", async () => {
  const { openingRead } = await import("@/modules/finance/opening/http");
  const r = await openingRead(request("selected"), "SOURCE", batch);
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(r.headers.get("content-disposition")).toContain("attachment");
  expect(await r.text()).toBe(JSON.stringify(source()));
  const first = await openingLines(people.owner, batch),
    second = await openingLines(people.owner, batch, { page: 2 });
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(11);
  expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(
    36,
  );
  for (const who of ["other", "hr", "lead", "member"])
    expect((await openingRead(request(who), "SOURCE", batch)).status).toBe(403);
  env.FINANCE_ENABLED = false;
  try {
    expect((await openingRead(request(), "DETAIL", batch)).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("retains explicit opening metadata and never issues a new invoice PDF for legacy balances", async () => {
  const line = (
    await sql.query(
      `SELECT id FROM "FinanceOpeningLine" WHERE "batchId"=$1 AND kind='AR'`,
      [batch],
    )
  ).rows[0];
  const { invoiceDetail } =
      await import("@/modules/finance/receivables/service"),
    { invoicePdf } = await import("@/modules/finance/documents/invoice-pdf");
  const d = await invoiceDetail(people.owner, line.id);
  expect(d.opening).toMatchObject({
    batchId: batch,
    cutoverDate: "2020-01-01",
    kind: "AR",
  });
  await expect(invoicePdf(people.owner, line.id)).rejects.toMatchObject({
    code: "FINANCE_OPENING_DOCUMENT",
  });
});
async function customer(
  resource: Parameters<
    typeof import("@/modules/finance/receivables/customer/service").customerCommand
  >[2],
  action: "CREATE" | "POST" | "UPDATE",
  body: unknown,
) {
  const { customerCommand } =
      await import("@/modules/finance/receivables/customer/service"),
    v = await proof();
  return customerCommand(
    v.actor,
    v.proof,
    resource,
    action,
    body,
    crypto.randomUUID(),
  );
}
async function supplierAction(
  resource: Parameters<
    typeof import("@/modules/finance/payables/supplier/service").supplierCommand
  >[2],
  action: "CREATE" | "POST",
  body: unknown,
) {
  const { supplierCommand } =
      await import("@/modules/finance/payables/supplier/service"),
    v = await proof();
  return supplierCommand(
    v.actor,
    v.proof,
    resource,
    action,
    body,
    crypto.randomUUID(),
  );
}
async function original(kind: string, key?: string) {
  const rows = (
    await sql.query(
      'SELECT id,"accountId" FROM "FinanceOpeningLine" WHERE "batchId"=$1 AND kind=$2',
      [batch, kind],
    )
  ).rows;
  return rows.find((x) => !key || x.accountId === accounts[key])!;
}
it("collects legacy receivables and applies imported advances without duplicate income or cash", async () => {
  const ar = await original("AR"),
    advance = await original("CLIENT_ADVANCE");
  const d = await customer("RECEIPT", "CREATE", {
    reference: "Actual cutover collection",
    partyId: client,
    cashAccountId: bank,
    documentDate: "2020-01-02",
    postingDate: "2020-01-02",
    description: "Collect an imported unpaid invoice",
    evidence: "Actual synthetic bank receipt",
    cashAmount: "40.00",
    allocations: [{ invoiceId: ar.id, amount: "40.00" }],
    reason: "Collect legacy balance once",
  });
  await customer("RECEIPT", "POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual legacy collection",
  });
  const a = await customer("ADVANCE_APPLICATION", "CREATE", {
    reference: "Apply imported advance",
    partyId: client,
    sourceDocumentId: advance.id,
    documentDate: "2020-01-02",
    postingDate: "2020-01-02",
    description: "Use the imported held client advance",
    evidence: "Reviewed opening advance source",
    allocations: [{ invoiceId: ar.id, amount: "10.00" }],
    reason: "Apply original advance without cash",
  });
  await customer("ADVANCE_APPLICATION", "POST", {
    id: a.id,
    expectedVersion: a.version,
    reason: "Post reviewed legacy advance use",
  });
  expect(
    (
      await db.financeReceivableEvent.aggregate({
        where: { invoiceId: ar.id },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
  ).toBe("50.00");
  expect(
    (
      await db.financeClientBalanceEvent.aggregate({
        where: { sourceDocumentId: advance.id },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
  ).toBe("15.00");
  const income = (
    await sql.query(
      `SELECT coalesce(sum(l.credit-l.debit),0)::numeric(20,2)::text AS amount FROM "FinanceJournalLine" l JOIN "FinanceAccount" a ON a.id=l."accountId" WHERE a.type IN('INCOME','OTHER_INCOME')`,
    )
  ).rows[0].amount;
  expect(income).toBe("0.00");
});
it("settles imported supplier balances and uses held supplier advances exactly once", async () => {
  const bill = await original("AP"),
    advance = await original("SUPPLIER_ADVANCE");
  const a = await supplierAction("ADVANCE_APPLICATION", "CREATE", {
    reference: "Use imported supplier advance",
    partyId: supplier,
    sourceDocumentId: advance.id,
    documentDate: "2020-01-02",
    postingDate: "2020-01-02",
    description: "Apply original supplier-held balance",
    evidence: "Reviewed synthetic supplier agreement",
    allocations: [{ billId: bill.id, amount: "5.00" }],
    reason: "Use imported supplier advance once",
  });
  await supplierAction("ADVANCE_APPLICATION", "POST", {
    id: a.id,
    expectedVersion: a.version,
    reason: "Post supplier advance allocation",
  });
  const d = await supplierAction("PAYMENT", "CREATE", {
    reference: "Pay imported bill",
    partyId: supplier,
    cashAccountId: bank,
    documentDate: "2020-01-02",
    postingDate: "2020-01-02",
    description: "Actual payment of legacy payable",
    evidence: "Actual synthetic bank payment",
    cashAmount: "20.00",
    allocations: [{ billId: bill.id, amount: "20.00" }],
    reason: "Settle original payable once",
  });
  await supplierAction("PAYMENT", "POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post actual legacy bill settlement",
  });
  expect(
    (
      await db.financePayableEvent.aggregate({
        where: { billId: bill.id },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
  ).toBe("35.00");
  expect(
    (
      await db.financeSupplierBalanceEvent.aggregate({
        where: { sourceDocumentId: advance.id },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
  ).toBe("7.00");
});
it("repays imported loan principal through the normal movement workflow", async () => {
  const { movementCommand } =
      await import("@/modules/finance/treasury/service"),
    v = await proof();
  const d = await movementCommand(
    v.actor,
    v.proof,
    "CREATE",
    {
      kind: "LOAN_REPAYMENT",
      reference: "Repay opening principal",
      loanId: loanIn,
      fromCashId: bank,
      documentDate: "2020-01-02",
      postingDate: "2020-01-02",
      description: "Repay imported principal",
      evidence: "Actual synthetic bank loan repayment",
      amount: "10.00",
      reason: "Settle reviewed opening loan",
    },
    crypto.randomUUID(),
  );
  const p = await proof();
  await movementCommand(
    p.actor,
    p.proof,
    "POST",
    {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post actual legacy repayment",
    },
    crypto.randomUUID(),
  );
  expect(
    (
      await db.financeLoanEvent.aggregate({
        where: { loanId: loanIn, bucket: "PRINCIPAL" },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
  ).toBe("30.00");
});
it("disposes an imported investment lot with exact original units and carrying basis", async () => {
  const lot = await original("INVESTMENT"),
    { movementCommand } = await import("@/modules/finance/treasury/service"),
    v = await proof();
  const d = await movementCommand(
    v.actor,
    v.proof,
    "CREATE",
    {
      kind: "INVESTMENT_DISPOSAL",
      reference: "Sell imported lot portion",
      holdingId: holding,
      toCashId: bank,
      documentDate: "2020-01-03",
      postingDate: "2020-01-03",
      description: "Dispose of imported original units",
      evidence: "Actual synthetic investment proceeds",
      approvalEvidence: "Reviewed original lot, units and carrying basis",
      amount: "40.00",
      allocations: [{ lotId: lot.id, units: "1.250000" }],
      reason: "Dispose reviewed legacy lot portion",
    },
    crypto.randomUUID(),
  );
  const p = await proof();
  await movementCommand(
    p.actor,
    p.proof,
    "POST",
    {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post actual disposal of legacy lot",
    },
    crypto.randomUUID(),
  );
  const events = await db.financeInvestmentEvent.aggregate({
    where: { lotId: lot.id },
    _sum: { costDelta: true, carryingDelta: true, unitsDelta: true },
  });
  expect(events._sum.costDelta?.toFixed(2)).toBe("35.00");
  expect(events._sum.carryingDelta?.toFixed(2)).toBe("40.00");
  expect(events._sum.unitsDelta?.toFixed(6)).toBe("1.250000");
});
it("depreciates only the imported asset's remaining carrying amount and preserves the opening proof", async () => {
  const asset = await original("ASSET"),
    { assetMovementCommand } =
      await import("@/modules/finance/assets/lifecycle/service"),
    v = await proof();
  const d = await assetMovementCommand(
    v.actor,
    v.proof,
    "GENERATE",
    {
      assetId: asset.id,
      month: "2020-01",
      postingDate: "2020-01-31",
      expenseAccountId: accounts.expense,
      accumulatedAccountId: accounts.accumulated,
      evidence: "Reviewed remaining asset use",
      approvalEvidence:
        "Original accumulated depreciation and remaining life reviewed",
      reason: "Prepare actual first post-cutover depreciation",
    },
    crypto.randomUUID(),
  );
  const p = await proof();
  await assetMovementCommand(
    p.actor,
    p.proof,
    "POST",
    {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post reviewed remaining-life charge",
    },
    crypto.randomUUID(),
  );
  const position = (
    await sql.query(
      "SELECT * FROM encova_finance_asset_position($1,'2020-01-31')",
      [asset.id],
    )
  ).rows[0];
  expect(position).toMatchObject({
    cost: "100.00",
    depreciation: "21.00",
    carrying: "79.00",
  });
  expect(
    (await openingDetail(people.owner, batch)).proof?.clearingBalance,
  ).toBe("0.00");
});

// F42 acceptance continues in the same wholly owned cutover books: no shared financial history is deleted.
const {
  automationCommand,
  recurringSchedules,
  recurringRuns,
  recurringRun,
  recognition,
  recognitions,
  preparationOptions,
} = await import("@/modules/finance/automation/service");
const { processRecurringRun, processFinanceRecurring } =
  await import("@/modules/finance/automation/worker");
async function auto(
  action: Parameters<typeof automationCommand>[2],
  body: unknown,
  id?: string,
  who = "owner",
  key = crypto.randomUUID(),
) {
  const p = await proof(who);
  return automationCommand(p.actor, p.proof, action, id, body, key);
}
const schedule = (
  kind: "BILL" | "JOURNAL" | "DEPRECIATION",
  template: Record<string, unknown>,
  patch: Record<string, unknown> = {},
) =>
  auto("CREATE", {
    name: "Reviewed monthly " + kind,
    kind,
    template: {
      description: "Reviewed recurring obligation or adjustment",
      ...template,
    },
    startMonth: "2020-02",
    endMonth: "2020-03",
    day: 1,
    evidence: "Explicit reviewed monthly amount and source classification",
    reason: "Configure reviewable drafts only",
    ...patch,
  });
let billSchedule: string, journalSchedule: string;
it("configures exact monthly bill and accrual templates without posting or creating a draft immediately", async () => {
  const before = await db.financeJournalEntry.count(),
    bills = await db.financeBill.count();
  billSchedule = (
    await schedule("BILL", {
      partyId: supplier,
      payableAccountId: accounts.ap,
      costAccountId: accounts.expense,
      amount: "10.01",
      dueDays: 15,
    })
  ).id;
  journalSchedule = (
    await schedule("JOURNAL", {
      debitAccountId: accounts.expense,
      creditAccountId: accounts.ordinary,
      amount: "2.01",
    })
  ).id;
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect(await db.financeBill.count()).toBe(bills);
  expect((await recurringSchedules(people.owner)).total).toBe(2);
});
it("prepares one actual draft per schedule and month across duplicate worker passes with no new journal or cash", async () => {
  const before = await db.financeJournalEntry.count();
  await processFinanceRecurring(Date.now() + 60000);
  await processFinanceRecurring(Date.now() + 60000);
  await processFinanceRecurring(Date.now() + 60000);
  const b = await db.financeRecurringRun.findMany({
      where: { scheduleId: billSchedule },
      orderBy: { month: "asc" },
    }),
    j = await db.financeRecurringRun.findMany({
      where: { scheduleId: journalSchedule },
    });
  expect(b).toHaveLength(2);
  expect(j).toHaveLength(2);
  expect(
    [...b, ...j].map((x) => ({
      state: x.state,
      attempts: x.attempts,
      error: x.errorCode,
    })),
  ).toEqual(
    Array.from({ length: 4 }, () => ({
      state: "READY",
      attempts: 1,
      error: null,
    })),
  );
  for (const r of b) {
    const draft = await db.financeBill.findUniqueOrThrow({
      where: { id: r.sourceId! },
    });
    expect(draft).toMatchObject({
      state: "DRAFT",
      totalAmount: expect.anything(),
    });
    expect(draft.totalAmount.toFixed(2)).toBe("10.01");
    expect(draft.reference).toBe(`REC-${billSchedule}-${r.month}`);
  }
  for (const r of j)
    expect(
      (
        await db.financeJournalDraft.findUniqueOrThrow({
          where: { id: r.sourceId! },
        })
      ).state,
    ).toBe("DRAFT");
  expect(await db.financeJournalEntry.count()).toBe(before);
  const history = await recurringRun(people.owner, b[0].id);
  expect(history.attempts).toHaveLength(1);
  expect(history.attempts[0].outcome).toBe("READY");
  expect(JSON.stringify(history)).not.toContain("leaseId");
});
it("resumes an expired lease and refuses its stale finisher without duplicating a draft", async () => {
  const s = await schedule(
    "JOURNAL",
    {
      debitAccountId: accounts.expense,
      creditAccountId: accounts.ordinary,
      amount: "1.00",
    },
    { startMonth: "2020-04", endMonth: "2020-04" },
  );
  await sql.query("SELECT encova_finance_automation_enqueue()");
  const run = await db.financeRecurringRun.findFirstOrThrow({
    where: { scheduleId: s.id },
  });
  const first = (
    await sql.query("SELECT encova_finance_automation_claim($1) AS data", [
      run.id,
    ])
  ).rows[0].data;
  await sql.query(
    'UPDATE "FinanceRecurringRun" SET "leaseUntil"=CURRENT_TIMESTAMP-interval \'1 second\',version=version+1 WHERE id=$1',
    [run.id],
  );
  const second = (
    await sql.query("SELECT encova_finance_automation_claim($1) AS data", [
      run.id,
    ])
  ).rows[0].data;
  expect(second.leaseId).not.toBe(first.leaseId);
  await sql.query("SELECT encova_finance_automation_finish($1,$2)", [
    run.id,
    first.leaseId,
  ]);
  expect(
    (await db.financeRecurringRun.findUniqueOrThrow({ where: { id: run.id } }))
      .sourceId,
  ).toBeNull();
  await sql.query("SELECT encova_finance_automation_finish($1,$2)", [
    run.id,
    second.leaseId,
  ]);
  const done = await recurringRun(people.owner, run.id);
  expect(done.run).toMatchObject({ state: "READY", attempts: 2 });
  expect(done.attempts.map((a) => a.outcome)).toEqual(["EXPIRED", "READY"]);
});
it("records failed mappings, retains safe attempt history and requires current-owner review for retry", async () => {
  const missing = crypto.randomUUID(),
    s = await schedule(
      "BILL",
      {
        partyId: supplier,
        payableAccountId: accounts.ap,
        costAccountId: missing,
        amount: "10.00",
        dueDays: 0,
      },
      { startMonth: "2020-05", endMonth: "2020-05" },
    );
  const count = await db.financeBill.count();
  await processFinanceRecurring(Date.now() + 60000);
  const run = await db.financeRecurringRun.findFirstOrThrow({
    where: { scheduleId: s.id },
  });
  expect(run).toMatchObject({
    state: "FAILED",
    attempts: 1,
    errorCode: "FINANCE_AUTOMATION_MAPPING",
    sourceId: null,
  });
  expect(await db.financeBill.count()).toBe(count);
  await expect(
    auto(
      "RETRY",
      { expectedVersion: run.version, reason: "Unauthorized retry" },
      run.id,
      "selected",
    ),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_REQUIRED" });
  await auto(
    "RETRY",
    {
      expectedVersion: run.version,
      reason: "Review failed preparation and retry",
    },
    run.id,
  );
  await processRecurringRun(run.id);
  expect(
    (await recurringRun(people.owner, run.id)).attempts.map((a) => a.outcome),
  ).toEqual(["FAILED", "FAILED"]);
  await expect(
    sql.query(
      'UPDATE "FinanceRecurringAttempt" SET "errorCode"=NULL WHERE "runId"=$1',
      [run.id],
    ),
  ).rejects.toThrow("FINANCE_AUTOMATION_RETAINED");
});
it("checks the original grant again at release and cancels a revoked claimed job before any draft exists", async () => {
  const s = await schedule(
    "JOURNAL",
    {
      debitAccountId: accounts.expense,
      creditAccountId: accounts.ordinary,
      amount: "1.00",
    },
    { startMonth: "2020-06", endMonth: "2020-06" },
  );
  await sql.query("SELECT encova_finance_automation_enqueue()");
  const run = await db.financeRecurringRun.findFirstOrThrow({
      where: { scheduleId: s.id },
    }),
    claim = (
      await sql.query("SELECT encova_finance_automation_claim($1) AS data", [
        run.id,
      ])
    ).rows[0].data;
  await sql.query("BEGIN");
  try {
    await sql.query(
      'UPDATE "FinanceSettings" SET "ownerId"=$1,"ownerGrantId"=(SELECT id FROM "FinanceGrant" WHERE "userId"=$1 AND "revokedAt" IS NULL),version=version+1',
      [people.selected.id],
    );
    await sql.query(
      'UPDATE "FinanceGrant" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedById"=$1,version=version+1 WHERE id=$2',
      [people.owner.id, run.grantId],
    );
    await sql.query("SELECT encova_finance_automation_finish($1,$2)", [
      run.id,
      claim.leaseId,
    ]);
    const result = (
      await sql.query(
        'SELECT state,"sourceId" FROM "FinanceRecurringRun" WHERE id=$1',
        [run.id],
      )
    ).rows[0];
    expect(result).toMatchObject({ state: "CANCELLED", sourceId: null });
  } finally {
    await sql.query("ROLLBACK");
  }
  await processRecurringRun(run.id); // Active lease remains owned until it expires; cannot steal it.
  expect(
    (await db.financeRecurringRun.findUniqueOrThrow({ where: { id: run.id } }))
      .state,
  ).toBe("RUNNING");
  await sql.query(
    'UPDATE "FinanceRecurringRun" SET "leaseUntil"=CURRENT_TIMESTAMP-interval \'1 second\',version=version+1 WHERE id=$1',
    [run.id],
  );
  await processRecurringRun(run.id);
  expect(
    (await db.financeRecurringRun.findUniqueOrThrow({ where: { id: run.id } }))
      .state,
  ).toBe("READY");
});
it("pauses schedules and cancels an already claimed run without permitting automatic posting", async () => {
  const s = await schedule(
    "JOURNAL",
    {
      debitAccountId: accounts.expense,
      creditAccountId: accounts.ordinary,
      amount: "1.00",
    },
    { startMonth: "2020-07", endMonth: "2020-07" },
  );
  await sql.query("SELECT encova_finance_automation_enqueue()");
  const run = await db.financeRecurringRun.findFirstOrThrow({
      where: { scheduleId: s.id },
    }),
    claim = (
      await sql.query("SELECT encova_finance_automation_claim($1) AS data", [
        run.id,
      ])
    ).rows[0].data;
  const paused = await auto(
    "PAUSE",
    { expectedVersion: s.version, reason: "Pause future draft preparation" },
    s.id,
  );
  await sql.query("SELECT encova_finance_automation_finish($1,$2)", [
    run.id,
    claim.leaseId,
  ]);
  expect(
    (await db.financeRecurringRun.findUniqueOrThrow({ where: { id: run.id } }))
      .state,
  ).toBe("CANCELLED");
  await auto(
    "RESUME",
    {
      expectedVersion: paused.version,
      reason: "Resume future reviewed months",
    },
    s.id,
  );
  await processFinanceRecurring(Date.now() + 60000);
  expect(
    await db.financeRecurringRun.count({ where: { scheduleId: s.id } }),
  ).toBe(1);
});
let recognitionId: string;
it("previews available deferred lines and posts exactly evidenced recognition without new receivables or cash", async () => {
  const line = await db.financeOpeningLine.findFirstOrThrow({
      where: { batchId: batch, kind: "DEFERRED" },
    }),
    cashBefore = (
      await sql.query(
        'SELECT coalesce(sum(l.debit-l.credit),0)::text AS balance FROM "FinanceJournalLine" l WHERE "accountId"=$1',
        [accounts.cash],
      )
    ).rows[0].balance,
    arBefore = await db.financeReceivableEvent.count();
  const options = await preparationOptions(people.owner, {
    kind: "DEFERRED",
    asOf: "2020-02-15",
  });
  expect(
    options.items.some((x) => x.id === line.id && x.balance === "16.00"),
  ).toBe(true);
  const d = await auto("RECOGNITION_CREATE", {
    invoiceLineId: line.id,
    postingDate: "2020-02-15",
    amount: "5.01",
    description: "Earn reviewed portion of legacy service",
    evidence: "Documented delivered service acceptance",
    reason: "Draft earned deferred obligation",
  });
  recognitionId = d.id;
  const key = crypto.randomUUID(),
    posted = await auto(
      "RECOGNITION_POST",
      {
        expectedVersion: d.version,
        reason: "Post evidenced service recognition",
      },
      d.id,
      "owner",
      key,
    ),
    again = await auto(
      "RECOGNITION_POST",
      {
        expectedVersion: d.version,
        reason: "Post evidenced service recognition",
      },
      d.id,
      "owner",
      key,
    );
  expect(again).toEqual(posted);
  expect((await recognition(people.owner, d.id)).item).toMatchObject({
    state: "POSTED",
    amount: "5.01",
    journalId: posted.journalId,
  });
  expect(await db.financeReceivableEvent.count()).toBe(arBefore);
  expect(
    (
      await sql.query(
        'SELECT coalesce(sum(l.debit-l.credit),0)::text AS balance FROM "FinanceJournalLine" l WHERE "accountId"=$1',
        [accounts.cash],
      )
    ).rows[0].balance,
  ).toBe(cashBefore);
  expect(
    (
      await sql.query(
        "SELECT encova_finance_deferred_capacity($1,'2020-02-15')::text AS n",
        [line.id],
      )
    ).rows[0].n,
  ).toBe("10.99");
  expect(
    (await openingDetail(people.owner, batch)).proof?.clearingBalance,
  ).toBe("0.00");
});
it("protects future reserved deferred obligations from a competing earlier recognition", async () => {
  const line = await db.financeOpeningLine.findFirstOrThrow({
      where: { batchId: batch, kind: "DEFERRED" },
    }),
    draft = (date: string, amount: string) =>
      auto("RECOGNITION_CREATE", {
        invoiceLineId: line.id,
        postingDate: date,
        amount,
        description: "Evidenced delivered deferred service",
        evidence: "Owner reviews exact delivered portion",
        reason: "Prepare service recognition",
      });
  const future = await draft("2020-03-15", "10.99");
  await auto(
    "RECOGNITION_POST",
    {
      expectedVersion: future.version,
      reason: "Recognize later delivered service",
    },
    future.id,
  );
  const tooMuch = await draft("2020-02-16", "0.01"),
    before = await db.financeJournalEntry.count();
  await expect(
    auto(
      "RECOGNITION_POST",
      {
        expectedVersion: tooMuch.version,
        reason: "Competing earlier recognition",
      },
      tooMuch.id,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_RECOGNITION_CAPACITY" });
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect((await recognition(people.owner, tooMuch.id)).item.state).toBe(
    "DRAFT",
  );
  await auto(
    "RECOGNITION_VOID",
    {
      expectedVersion: tooMuch.version,
      reason: "Retain rejected recognition draft",
    },
    tooMuch.id,
  );
});
it("reverses an actual recognition at a later date while retaining earlier balances and the original exact journal", async () => {
  const original = await recognition(people.owner, recognitionId),
    before = await db.financeJournalLine.findMany({
      where: { journalId: original.item.journalId! },
      orderBy: { sequence: "asc" },
    });
  const r = await auto(
    "RECOGNITION_REVERSE",
    {
      expectedVersion: original.item.version,
      postingDate: "2020-04-15",
      reason: "Reverse service acceptance with dated evidence",
    },
    recognitionId,
  );
  expect((await recognition(people.owner, recognitionId)).item).toMatchObject({
    state: "REVERSED",
    reversalJournalId: r.journalId,
    reversalDate: expect.stringContaining("2020-04-15"),
  });
  const reverse = await db.financeJournalLine.findMany({
    where: { journalId: r.journalId },
    orderBy: { sequence: "asc" },
  });
  expect(
    reverse.map((x) => [x.accountId, x.debit.toFixed(2), x.credit.toFixed(2)]),
  ).toEqual(
    before.map((x) => [x.accountId, x.credit.toFixed(2), x.debit.toFixed(2)]),
  );
  expect(
    (
      await sql.query(
        'SELECT coalesce(sum(amount),0)::text AS balance FROM "FinanceDeferredRevenueEvent" WHERE "invoiceLineId"=$1 AND "effectiveDate"<=\'2020-02-28\'',
        [original.item.invoiceLineId],
      )
    ).rows[0].balance,
  ).toBe("10.99");
  expect(
    (
      await sql.query(
        "SELECT encova_finance_deferred_capacity($1,'2020-04-15')::text AS balance",
        [original.item.invoiceLineId],
      )
    ).rows[0].balance,
  ).toBe("5.01");
  await expect(
    sql.query('UPDATE "FinanceRecognition" SET amount=1 WHERE id=$1', [
      recognitionId,
    ]),
  ).rejects.toThrow("FINANCE_RECOGNITION_RETAINED");
});
it("denies automation and recognition mutations by all unselected roles and raw draft-core execution by the runtime", async () => {
  for (const who of ["selected", "other", "hr", "lead", "member"])
    await expect(scheduleDenied(who)).rejects.toMatchObject({
      code: who === "selected" ? "FINANCE_OWNER_REQUIRED" : "FINANCE_FORBIDDEN",
    });
  async function scheduleDenied(who: string) {
    return auto(
      "PREPARE",
      { reason: "Unauthorized draft job preparation" },
      undefined,
      who,
    );
  }
  for (const role of ["encova_app", "anon", "authenticated"]) {
    const acl = (
      await sql.query(
        "SELECT has_function_privilege($1,'encova_finance_bill_core(uuid,text,jsonb,text,uuid)','EXECUTE') AS core,has_table_privilege($1,'\"FinanceRecognition\"','INSERT') AS write",
        [role],
      )
    ).rows[0];
    expect(acl).toMatchObject({ core: false, write: false });
  }
  expect((await recurringRuns(people.owner)).items.length).toBeLessThanOrEqual(
    25,
  );
  expect((await recognitions(people.owner)).total).toBe(3);
});
it("reuses one normal depreciation draft per asset/month even across reviewed schedules", async () => {
  const asset = await db.financeAsset.findFirstOrThrow(),
    template = {
      assetId: asset.id,
      expenseAccountId: accounts.expense,
      accumulatedAccountId: accounts.accumulated,
    };
  const before = await db.financeJournalEntry.count(),
    one = await schedule("DEPRECIATION", template, {
      startMonth: "2020-02",
      endMonth: "2020-02",
      day: 28,
    }),
    two = await schedule("DEPRECIATION", template, {
      startMonth: "2020-02",
      endMonth: "2020-02",
      day: 28,
    });
  await processFinanceRecurring(Date.now() + 60000);
  await processFinanceRecurring(Date.now() + 60000);
  const runs = await db.financeRecurringRun.findMany({
    where: { scheduleId: { in: [one.id, two.id] } },
  });
  expect(runs).toHaveLength(2);
  expect(runs.every((x) => x.state === "READY")).toBe(true);
  expect(runs[0].sourceId).toBe(runs[1].sourceId);
  expect(
    await db.financeAssetMovement.count({
      where: { assetId: asset.id, kind: "DEPRECIATION", month: "2020-02" },
    }),
  ).toBe(1);
  const draft = await db.financeAssetMovement.findUniqueOrThrow({
    where: { id: runs[0].sourceId! },
  });
  expect(draft.state).toBe("DRAFT");
  expect(draft.amount.toFixed(2)).toBe("1.00");
  expect(await db.financeJournalEntry.count()).toBe(before);
});
it("bounds manual recovery to nine retained attempts and requires a new explicit review to issue each retry", async () => {
  const run = await db.financeRecurringRun.findFirstOrThrow({
    where: { errorCode: "FINANCE_AUTOMATION_MAPPING", state: "FAILED" },
  });
  for (let n = run.attempts; n < 9; n++) {
    const current = await db.financeRecurringRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    await auto(
      "RETRY",
      {
        expectedVersion: current.version,
        reason: "Review unresolved mapping and explicit bounded retry",
      },
      run.id,
    );
    await processRecurringRun(run.id);
  }
  const final = await recurringRun(people.owner, run.id);
  expect(final.run).toMatchObject({ state: "FAILED", attempts: 9, budget: 9 });
  expect(final.attempts).toHaveLength(9);
  await expect(
    auto(
      "RETRY",
      {
        expectedVersion: final.run.version,
        reason: "Attempt beyond retained retry limit",
      },
      run.id,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_AUTOMATION_STATE" });
});
it("requires owner opening-equity review for an imported customer credit and keeps clearing/current sales unchanged", async () => {
  const line = await db.financeOpeningLine.findFirstOrThrow({
      where: { batchId: batch, kind: "AR" },
    }),
    d = await customer("CUSTOMER_CREDIT", "CREATE", {
      reference: "LEGACY-AR-CREDIT",
      partyId: client,
      invoiceId: line.id,
      documentDate: "2020-08-01",
      postingDate: "2020-08-01",
      description: "Reviewed reduction of imported unpaid balance",
      evidence: "Original legacy credit evidence",
      advanceAccountId: accounts.clientAdvance,
      creditLines: [{ invoiceLineId: line.id, amount: "3.01" }],
      reason: "Prepare imported balance correction",
    });
  await expect(
    customer("CUSTOMER_CREDIT", "POST", {
      id: d.id,
      expectedVersion: d.version,
      reason: "Try unreviewed opening credit",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_OPENING_CREDIT_REVIEW" });
  const review = {
    side: "CUSTOMER",
    documentId: d.id,
    expectedVersion: d.version,
    offsetAccountId: accounts.retained,
    evidence: "Owner reviewed correction to original retained opening equity",
    reason: "Approve exact imported credit classification",
  };
  await expect(
    auto("OPENING_CREDIT_REVIEW", review, undefined, "selected"),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_REQUIRED" });
  await auto("OPENING_CREDIT_REVIEW", review);
  const posted = await customer("CUSTOMER_CREDIT", "POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post owner-reviewed imported credit",
  });
  const lines = await db.financeJournalLine.findMany({
    where: { journalId: posted.journalId! },
  });
  expect(
    lines.map((x) => ({
      accountId: x.accountId,
      debit: x.debit.toFixed(2),
      credit: x.credit.toFixed(2),
    })),
  ).toContainEqual({
    accountId: accounts.retained,
    debit: "3.01",
    credit: "0.00",
  });
  expect(
    lines.some(
      (x) =>
        x.accountId === accounts.clearing || x.accountId === accounts.revenue,
    ),
  ).toBe(false);
  expect(
    (
      await sql.query(
        'SELECT coalesce(sum(debit-credit),0)::text AS n FROM "FinanceJournalLine" WHERE "accountId"=$1',
        [accounts.clearing],
      )
    ).rows[0].n,
  ).toBe("0.00");
});
it("reviews an imported supplier credit against opening equity without reducing current costs or clearing", async () => {
  const line = await db.financeOpeningLine.findFirstOrThrow({
      where: { batchId: batch, kind: "AP" },
    }),
    d = await supplierAction("SUPPLIER_CREDIT", "CREATE", {
      reference: "LEGACY-AP-CREDIT",
      partyId: supplier,
      billId: line.id,
      documentDate: "2020-08-01",
      postingDate: "2020-08-01",
      description: "Reviewed supplier reduction of imported balance",
      evidence: "Original supplier credit evidence",
      advanceAccountId: accounts.supplierAdvance,
      creditLines: [{ billLineId: line.id, amount: "2.01" }],
      reason: "Prepare imported supplier correction",
    });
  await expect(
    supplierAction("SUPPLIER_CREDIT", "POST", {
      id: d.id,
      expectedVersion: d.version,
      reason: "Try unreviewed supplier credit",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_OPENING_CREDIT_REVIEW" });
  await auto("OPENING_CREDIT_REVIEW", {
    side: "SUPPLIER",
    documentId: d.id,
    expectedVersion: d.version,
    offsetAccountId: accounts.retained,
    evidence: "Owner reviewed legacy supplier correction to opening equity",
    reason: "Approve exact supplier credit classification",
  });
  const posted = await supplierAction("SUPPLIER_CREDIT", "POST", {
    id: d.id,
    expectedVersion: d.version,
    reason: "Post reviewed supplier correction",
  });
  const lines = await db.financeJournalLine.findMany({
    where: { journalId: posted.journalId! },
  });
  expect(
    lines.map((x) => ({
      accountId: x.accountId,
      debit: x.debit.toFixed(2),
      credit: x.credit.toFixed(2),
    })),
  ).toContainEqual({
    accountId: accounts.retained,
    debit: "0.00",
    credit: "2.01",
  });
  expect(
    lines.some(
      (x) =>
        x.accountId === accounts.clearing || x.accountId === accounts.expense,
    ),
  ).toBe(false);
});
it("rechecks feature and current access for every new private API read and returns no raw lease or grant", async () => {
  const { automationRead } = await import("@/modules/finance/automation/http");
  const r = await automationRead(request(), "SCHEDULES");
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(JSON.stringify(await r.json())).not.toContain("grantId");
  for (const who of ["other", "hr", "lead", "member"])
    expect((await automationRead(request(who), "RECOGNITIONS")).status).toBe(
      403,
    );
  env.FINANCE_ENABLED = false;
  try {
    expect((await automationRead(request(), "SCHEDULES")).status).toBe(404);
    await processFinanceRecurring();
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("posts a prepared normal bill and journal only through separate fresh verified source actions", async () => {
  const run = await db.financeRecurringRun.findFirstOrThrow({
      where: { scheduleId: billSchedule, state: "READY" },
    }),
    bill = await db.financeBill.findUniqueOrThrow({
      where: { id: run.sourceId! },
    }),
    before = await db.financeJournalEntry.count();
  const { billCommand } = await import("@/modules/finance/payables/service"),
    { ledgerCommand } = await import("@/modules/finance/ledger/service");
  let p = await proof();
  const posted = await billCommand(
    p.actor,
    p.proof,
    "POST",
    {
      id: bill.id,
      expectedVersion: bill.version,
      reason: "Independently review original recurring supplier bill",
    },
    crypto.randomUUID(),
  );
  expect(posted.journalId).toBeTruthy();
  const jr = await db.financeRecurringRun.findFirstOrThrow({
      where: { scheduleId: journalSchedule, state: "READY" },
    }),
    journal = await db.financeJournalDraft.findUniqueOrThrow({
      where: { id: jr.sourceId! },
    });
  p = await proof();
  const j = await ledgerCommand(
    p.actor,
    p.proof,
    "POST",
    {
      id: journal.id,
      expectedVersion: journal.version,
      reason: "Independently review monthly prepaid recognition",
    },
    crypto.randomUUID(),
  );
  expect(j.journalId).toBeTruthy();
  expect(await db.financeJournalEntry.count()).toBe(before + 2);
  expect(
    await db.financeRecurringRun.count({
      where: { id: { in: [run.id, jr.id] }, state: "READY" },
    }),
  ).toBe(2);
});
it("requires a new retained owner classification when an imported credit draft changes", async () => {
  const line = await db.financeOpeningLine.findFirstOrThrow({
      where: { batchId: batch, kind: "AR" },
    }),
    body = {
      reference: "CHANGED-LEGACY-CREDIT",
      partyId: client,
      invoiceId: line.id,
      documentDate: "2020-09-01",
      postingDate: "2020-09-01",
      description: "Original reviewed imported credit",
      evidence: "Original evidence before update",
      advanceAccountId: accounts.clientAdvance,
      creditLines: [{ invoiceLineId: line.id, amount: "1.00" }],
      reason: "Prepare exact legacy credit draft",
    },
    d = await customer("CUSTOMER_CREDIT", "CREATE", body),
    review = {
      side: "CUSTOMER",
      documentId: d.id,
      expectedVersion: d.version,
      offsetAccountId: accounts.retained,
      evidence: "Owner reviewed original opening equity adjustment",
      reason: "Bind exact source classification",
    };
  await auto("OPENING_CREDIT_REVIEW", review);
  const changed = await customer("CUSTOMER_CREDIT", "UPDATE", {
    ...body,
    id: d.id,
    expectedVersion: d.version,
    description: "Changed source requires independent owner review",
  });
  await expect(
    customer("CUSTOMER_CREDIT", "POST", {
      id: d.id,
      expectedVersion: changed.version,
      reason: "Try obsolete classification",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_OPENING_CREDIT_REVIEW" });
  await auto("OPENING_CREDIT_REVIEW", {
    ...review,
    expectedVersion: changed.version,
    evidence: "Owner reviewed changed exact opening adjustment",
  });
  await customer("CUSTOMER_CREDIT", "POST", {
    id: d.id,
    expectedVersion: changed.version,
    reason: "Post newly reviewed exact credit",
  });
  expect(
    await db.financeOpeningCreditReview.count({
      where: { customerDocumentId: d.id },
    }),
  ).toBe(2);
});

it("rejects forged schedule ownership, out-of-range runs and invented attempt history at the database boundary", async () => {
  const grant = await db.financeGrant.findFirstOrThrow({
      where: { userId: people.owner.id, revokedAt: null },
    }),
    count = await db.financeRecurringSchedule.count();
  await expect(
    sql.query(
      "INSERT INTO \"FinanceRecurringSchedule\"(id,name,kind,template,\"startMonth\",\"endMonth\",day,evidence,\"createdById\",\"grantId\") VALUES($1,'Forged owner','JOURNAL',$2,'2020-12','2020-12',1,'Synthetic invalid metadata',$3,$4)",
      [
        crypto.randomUUID(),
        {
          description: "Reviewed source",
          debitAccountId: accounts.expense,
          creditAccountId: accounts.ordinary,
          amount: "1.00",
          projectId: null,
        },
        people.selected.id,
        grant.id,
      ],
    ),
  ).rejects.toThrow("FINANCE_OWNER_REQUIRED");
  expect(await db.financeRecurringSchedule.count()).toBe(count);
  await expect(
    sql.query(
      'INSERT INTO "FinanceRecurringRun"(id,"scheduleId",month,"postingDate","requesterId","grantId") VALUES($1,$2,\'2030-01\',\'2030-01-01\',$3,$4)',
      [crypto.randomUUID(), billSchedule, people.owner.id, grant.id],
    ),
  ).rejects.toThrow("FINANCE_AUTOMATION_SOURCE");
  const run = await db.financeRecurringRun.findFirstOrThrow({
    where: { scheduleId: billSchedule, state: "READY" },
  });
  await expect(
    sql.query(
      'INSERT INTO "FinanceRecurringAttempt"(id,"runId",attempt,"leaseId") VALUES($1,$2,9,$3)',
      [crypto.randomUUID(), run.id, crypto.randomUUID()],
    ),
  ).rejects.toThrow("FINANCE_AUTOMATION_SOURCE");
});
it("rejects readiness that points to an invented source even after a valid job and lease exist", async () => {
  const s = await schedule(
    "JOURNAL",
    {
      debitAccountId: accounts.expense,
      creditAccountId: accounts.ordinary,
      amount: "0.01",
    },
    { startMonth: "2020-10", endMonth: "2020-10" },
  );
  await sql.query("SELECT encova_finance_automation_enqueue()");
  const run = await db.financeRecurringRun.findFirstOrThrow({
      where: { scheduleId: s.id },
    }),
    claim = (
      await sql.query("SELECT encova_finance_automation_claim($1) AS data", [
        run.id,
      ])
    ).rows[0].data;
  await expect(
    sql.query(
      'UPDATE "FinanceRecurringRun" SET state=\'READY\',version=version+1,"leaseId"=NULL,"leaseUntil"=NULL,"sourceId"=$2,"sourceType"=\'JOURNAL\' WHERE id=$1',
      [run.id, crypto.randomUUID()],
    ),
  ).rejects.toThrow("FINANCE_AUTOMATION_SOURCE");
  expect(
    (await db.financeRecurringRun.findUniqueOrThrow({ where: { id: run.id } }))
      .state,
  ).toBe("RUNNING");
  await sql.query("SELECT encova_finance_automation_finish($1,$2)", [
    run.id,
    claim.leaseId,
  ]);
  expect(
    (await db.financeRecurringRun.findUniqueOrThrow({ where: { id: run.id } }))
      .state,
  ).toBe("READY");
});
it("rejects forged, stale or non-equity opening-credit reviews independently of the API", async () => {
  const line = await db.financeOpeningLine.findFirstOrThrow({
      where: { batchId: batch, kind: "AR" },
    }),
    d = await customer("CUSTOMER_CREDIT", "CREATE", {
      reference: "F44-REVIEW-BOUNDARY",
      partyId: client,
      invoiceId: line.id,
      documentDate: "2020-12-01",
      postingDate: "2020-12-01",
      description: "Exact source for independent review guard",
      evidence: "Synthetic boundary evidence",
      advanceAccountId: accounts.clientAdvance,
      creditLines: [{ invoiceLineId: line.id, amount: "0.01" }],
      reason: "Prepare guarded input review fixture",
    }),
    basis = (
      await sql.query(
        "SELECT encova_finance_opening_credit_basis('CUSTOMER',$1) AS hash",
        [d.id],
      )
    ).rows[0].hash;
  const insert = (actor: string, account: string, hash: string) =>
    sql.query(
      'INSERT INTO "FinanceOpeningCreditReview"(id,"customerDocumentId","offsetAccountId","basisHash",evidence,"createdById") VALUES($1,$2,$3,$4,\'Synthetic exact input review\',$5)',
      [crypto.randomUUID(), d.id, account, hash, actor],
    );
  await expect(
    insert(people.selected.id, accounts.retained, basis),
  ).rejects.toThrow("FINANCE_OWNER_REQUIRED");
  await expect(
    insert(people.owner.id, accounts.revenue, basis),
  ).rejects.toThrow("FINANCE_OPENING_CREDIT_REVIEW");
  await expect(
    insert(people.owner.id, accounts.retained, "0".repeat(64)),
  ).rejects.toThrow("FINANCE_OPENING_CREDIT_REVIEW");
  expect(
    await db.financeOpeningCreditReview.count({
      where: { customerDocumentId: d.id },
    }),
  ).toBe(0);
  await auto("OPENING_CREDIT_REVIEW", {
    side: "CUSTOMER",
    documentId: d.id,
    expectedVersion: d.version,
    offsetAccountId: accounts.retained,
    evidence: "Owner reviews exact original source through verified action",
    reason: "Prove normal current-owner review still works",
  });
  expect(
    await db.financeOpeningCreditReview.count({
      where: { customerDocumentId: d.id },
    }),
  ).toBe(1);
});
it("does not revive an old queued job after ownership transfer, revocation and a newly issued grant", async () => {
  const s = await schedule(
    "JOURNAL",
    {
      debitAccountId: accounts.expense,
      creditAccountId: accounts.ordinary,
      amount: "0.01",
    },
    { startMonth: "2020-11", endMonth: "2020-11" },
  );
  await sql.query("SELECT encova_finance_automation_enqueue()");
  const run = await db.financeRecurringRun.findFirstOrThrow({
    where: { scheduleId: s.id },
  });
  await sql.query("BEGIN");
  try {
    await sql.query(
      'UPDATE "FinanceSettings" SET "ownerId"=$1,"ownerGrantId"=(SELECT id FROM "FinanceGrant" WHERE "userId"=$1 AND "revokedAt" IS NULL),version=version+1',
      [people.selected.id],
    );
    await sql.query(
      'UPDATE "FinanceGrant" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedById"=$1,version=version+1 WHERE id=$2',
      [people.selected.id, run.grantId],
    );
    const fresh = crypto.randomUUID();
    await sql.query(
      'INSERT INTO "FinanceGrant"(id,"userId","grantedById",reason) VALUES($1,$2,$3,\'Explicit synthetic new grant epoch\')',
      [fresh, people.owner.id, people.selected.id],
    );
    await sql.query(
      'UPDATE "FinanceSettings" SET "ownerId"=$1,"ownerGrantId"=$2,version=version+1',
      [people.owner.id, fresh],
    );
    expect(
      (
        await sql.query("SELECT encova_finance_automation_claim($1) AS data", [
          run.id,
        ])
      ).rows[0].data,
    ).toBeNull();
    expect(
      (
        await sql.query(
          'SELECT state,"sourceId" FROM "FinanceRecurringRun" WHERE id=$1',
          [run.id],
        )
      ).rows[0],
    ).toMatchObject({ state: "CANCELLED", sourceId: null });
  } finally {
    await sql.query("ROLLBACK");
  }
  await processRecurringRun(run.id);
  expect(
    (await db.financeRecurringRun.findUniqueOrThrow({ where: { id: run.id } }))
      .state,
  ).toBe("READY");
});
const ownerOnlyActions = [
  "CREATE",
  "PAUSE",
  "RESUME",
  "PREPARE",
  "RETRY",
  "RECOGNITION_CREATE",
  "RECOGNITION_POST",
  "RECOGNITION_VOID",
  "RECOGNITION_REVERSE",
  "OPENING_CREDIT_REVIEW",
] as const;
it.each(ownerOnlyActions)(
  "denies selected non-owner action %s without exposing or changing source state",
  async (action) => {
    const reason = "Unselected ownership boundary check",
      change = { expectedVersion: 1, reason };
    let body: unknown = change,
      id: string | undefined = billSchedule;
    if (action === "CREATE") {
      body = {
        name: "Denied reviewed schedule",
        kind: "JOURNAL",
        template: {
          description: "Reviewed ordinary source",
          debitAccountId: accounts.expense,
          creditAccountId: accounts.ordinary,
          amount: "1.00",
        },
        startMonth: "2020-12",
        endMonth: "2020-12",
        day: 1,
        evidence: "Reviewed synthetic source",
        reason,
      };
      id = undefined;
    }
    if (action === "PREPARE") {
      body = { reason };
      id = undefined;
    }
    if (action === "RECOGNITION_CREATE") {
      body = {
        invoiceLineId: crypto.randomUUID(),
        postingDate: "2020-01-01",
        amount: "0.01",
        description: "Denied recognition",
        evidence: "Denied owner action",
        reason,
      };
      id = undefined;
    }
    if (action === "RECOGNITION_REVERSE")
      body = { ...change, postingDate: "2020-01-02" };
    if (action === "OPENING_CREDIT_REVIEW") {
      body = {
        side: "CUSTOMER",
        documentId: crypto.randomUUID(),
        expectedVersion: 1,
        offsetAccountId: accounts.retained,
        evidence: "Denied review source",
        reason,
      };
      id = undefined;
    }
    await expect(auto(action, body, id, "selected")).rejects.toMatchObject({
      code: "FINANCE_OWNER_REQUIRED",
    });
  },
);
// Permission denial precedes filter validation, including deliberately unsupported filters on other modes.
it("denies every new private read mode to all unselected roles and stops before input/authentication when disabled", async () => {
  const { automationRead, automationMutation } =
      await import("@/modules/finance/automation/http"),
    run = await db.financeRecurringRun.findFirstOrThrow(),
    modes = [
      "SCHEDULES",
      "SCHEDULE",
      "RUNS",
      "RUN",
      "RECOGNITIONS",
      "RECOGNITION",
      "OPTIONS",
      "CREDIT_REVIEWS",
    ] as const;
  for (const who of ["other", "hr", "lead", "member"])
    for (const mode of modes) {
      const id =
          mode === "SCHEDULE"
            ? billSchedule
            : mode === "RECOGNITION"
              ? recognitionId
              : run.id,
        r = await automationRead(
          request(
            who,
            undefined,
            crypto.randomUUID(),
            "/api/v1/finance/automation/options?kind=ASSET",
          ),
          mode,
          id,
        );
      expect(r.status).toBe(403);
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(Object.keys(await r.json())).toEqual(["error"]);
    }
  env.FINANCE_ENABLED = false;
  try {
    for (const mode of modes)
      expect((await automationRead(request(), mode, run.id)).status).toBe(404);
    for (const action of ownerOnlyActions)
      expect(
        (await automationMutation(request("owner", {}), action, run.id)).status,
      ).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("keeps draft cores and new trigger helpers private while runtime tables remain read-only and browser roles have no read", async () => {
  for (const role of ["encova_app", "anon", "authenticated"]) {
    for (const table of [
      "FinanceRecurringSchedule",
      "FinanceRecurringRun",
      "FinanceRecurringAttempt",
      "FinanceRecognition",
      "FinanceOpeningCreditReview",
    ]) {
      const p = (
        await sql.query(
          "SELECT has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') AS write,has_table_privilege($1,$2,'SELECT') AS read",
          [role, '"' + table + '"'],
        )
      ).rows[0];
      expect(p.write).toBe(false);
      expect(p.read).toBe(role === "encova_app");
    }
    for (const fn of [
      "encova_finance_bill_core(uuid,text,jsonb,text,uuid)",
      "encova_finance_ledger_core(uuid,text,jsonb,text,uuid)",
      "encova_finance_asset_movement_core(uuid,text,jsonb,text,uuid)",
      "encova_finance_automation_insert_guard()",
      "encova_finance_automation_ready_guard()",
      "encova_finance_opening_credit_review_guard()",
    ]) {
      expect(
        (
          await sql.query(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
            [role, fn],
          )
        ).rows[0].allowed,
      ).toBe(false);
    }
  }
});

it("links every retained opening and recognition journal to its authorized source workflow", async () => {
  const { postedSource } =
    await import("@/modules/finance/reports/rollforwards/service");
  const entries = await db.financeJournalEntry.findMany({
    where: { sourceType: { in: ["OPENING", "RECOGNITION"] } },
  });
  expect(entries.some((e) => e.sourceType === "OPENING")).toBe(true);
  expect(entries.some((e) => e.sourceType === "RECOGNITION")).toBe(true);
  for (const entry of entries) {
    const result = await postedSource(people.owner, { id: entry.id });
    const id =
      entry.sourceType === "OPENING"
        ? (
            await db.financeOpeningPosting.findUniqueOrThrow({
              where: { id: entry.sourceId! },
            })
          ).batchId
        : entry.sourceId;
    expect(result.workflow?.href).toBe(
      `/finance/${entry.sourceType === "OPENING" ? "openings" : "recognitions"}/${id}`,
    );
    expect(result.difference).toBe("0.00");
  }
  for (const role of ["encova_app", "anon", "authenticated"]) {
    expect(
      (
        await sql.query(
          "SELECT has_function_privilege($1,'encova_finance_posted_source_before_workflow_links(uuid,jsonb)','EXECUTE') AS allowed",
          [role],
        )
      ).rows[0].allowed,
    ).toBe(false);
  }
});
