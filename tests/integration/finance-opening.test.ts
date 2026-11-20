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
  action: "CREATE" | "POST",
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
