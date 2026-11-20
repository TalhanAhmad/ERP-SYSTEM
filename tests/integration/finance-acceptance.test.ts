import "dotenv/config";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import pg from "pg";
// Multi-command report/close/reversal workflows take more than five seconds on CI.
// Bound only this file; retain every assertion and all production timeouts.
vi.setConfig({ testTimeout: 30_000 });
// A separate, fully owned database proves final readiness without deleting the regression database's retained books.
const reservation = createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((r) => reservation.close(() => r()));
const url = `postgresql://encova:local_only@localhost:${port}/encova_test`,
  directory = `.local/finance/acceptance-${crypto.randomUUID()}`;
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
import { seedAccountingAcceptance } from "../fixtures/finance-acceptance";
let fixture: Awaited<ReturnType<typeof seedAccountingAcceptance>>;
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
    const email = "acceptance." + name + "@example.test",
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
        username: "acceptance." + name,
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
  fixture = await seedAccountingAcceptance(proof);
}, 120000);
afterAll(async () => {
  vi.resetConfig();
  await db.$disconnect();
  await sql.end();
  await local.stop();
  await rm(directory, { recursive: true, force: true });
}, 30000);

const { generalLedger, trialBalance } =
    await import("@/modules/finance/reports/service"),
  { profitLoss, balanceSheet } =
    await import("@/modules/finance/reports/statements/service"),
  { cashFlow } = await import("@/modules/finance/reports/cash-flow/service"),
  { projectFinancialResult } =
    await import("@/modules/finance/projects/costs/service"),
  { rollforward, postedSource } =
    await import("@/modules/finance/reports/rollforwards/service");
const baseRange = { from: "2020-01-01", to: "2020-01-10" };
it("posts the nine specified real sources with exactly equal1,445,000 debits/credits and zero opening balances", async () => {
  expect(await db.financeJournalEntry.count()).toBe(9);
  expect(await db.financeOpeningBatch.count()).toBe(0);
  expect(new Set(fixture.journalIds).size).toBe(9);
  const totals = (
    await sql.query(
      'SELECT sum(debit)::text AS debit,sum(credit)::text AS credit FROM "FinanceJournalLine"',
    )
  ).rows[0];
  expect(totals).toEqual({ debit: "1445000.00", credit: "1445000.00" });
  expect(
    (await trialBalance(people.owner, baseRange)).companyTotals,
  ).toMatchObject({
    periodDebit: "1445000.00",
    periodCredit: "1445000.00",
    closingDebit: "905000.00",
    closingCredit: "905000.00",
    periodDifference: "0.00",
    closingDifference: "0.00",
  });
});
it("reconciles actual bank575,000, AR100,000, AP30,000 and loan75,000 to their control registers", async () => {
  const a = fixture.accounts,
    g = await generalLedger(people.owner, { ...baseRange, accountId: a.bank });
  expect(g).toMatchObject({
    openingBalance: "0.00",
    periodDebit: "800000.00",
    periodCredit: "225000.00",
    closingBalance: "575000.00",
  });
  const events = async (table: string, field: string, id: string) =>
    (
      await sql.query(
        `SELECT coalesce(sum(amount),0)::text AS n FROM "${table}" WHERE "${field}"=$1`,
        [id],
      )
    ).rows[0].n;
  expect(
    await events("FinanceReceivableEvent", "invoiceId", fixture.invoice.id),
  ).toBe("100000.00");
  expect(await events("FinancePayableEvent", "billId", fixture.bill.id)).toBe(
    "30000.00",
  );
  expect(
    (
      await sql.query(
        'SELECT sum(amount)::text AS n FROM "FinanceLoanEvent" WHERE "loanId"=$1 AND bucket=\'PRINCIPAL\'',
        [fixture.loan.id],
      )
    ).rows[0].n,
  ).toBe("75000.00");
  expect(
    (await generalLedger(people.owner, { ...baseRange, accountId: a.ar }))
      .closingBalance,
  ).toBe("100000.00");
  expect(
    (await generalLedger(people.owner, { ...baseRange, accountId: a.ap }))
      .closingBalance,
  ).toBe("-30000.00");
});
it("keeps60,000 equipment and50,000 investments as assets, yielding180,000 actual profit and a785,000 balance sheet", async () => {
  const pl = await profitLoss(people.owner, baseRange),
    bs = await balanceSheet(people.owner, { asOf: baseRange.to });
  expect(pl.sections).toMatchObject({
    revenue: "300000.00",
    directCosts: "120000.00",
    grossProfit: "180000.00",
    netProfit: "180000.00",
  });
  expect(bs.sections).toMatchObject({
    totalAssets: "785000.00",
    totalLiabilities: "105000.00",
    postedEquity: "500000.00",
    unclosedProfit: "180000.00",
    totalEquity: "680000.00",
    difference: "0.00",
  });
  const asset = (
    await sql.query(
      "SELECT * FROM encova_finance_asset_position($1,'2020-01-10')",
      [fixture.asset.id],
    )
  ).rows[0];
  expect(asset).toMatchObject({
    cost: "60000.00",
    depreciation: "0",
    carrying: "60000.00",
  });
  const inv = await rollforward(people.owner, "INVESTMENTS", baseRange);
  expect(
    inv.items.find(
      (x) => x.entityId === fixture.holding.id && x.metric === "CARRYING",
    )?.closingBalance,
  ).toBe("50000.00");
  expect(inv.reconciliation.ready).toBe(true);
});
it("reports operating110,000, investing-110,000 and financing575,000 cash without confusing principal or asset purchases with profit", async () => {
  const r = await cashFlow(people.owner, baseRange);
  expect(r).toMatchObject({
    openingBalance: "0.00",
    closingBalance: "575000.00",
    externalNet: "575000.00",
    internalNet: "0.00",
    difference: "0.00",
    unclassifiedCount: 0,
    classificationReady: true,
  });
  for (const [category, net] of [
    ["OPERATING", "110000.00"],
    ["INVESTING", "-110000.00"],
    ["FINANCING", "575000.00"],
  ])
    expect(r.categories.find((x) => x.category === category)?.net).toBe(net);
});
it("separates180,000 project contribution from110,000 recorded project cash", async () => {
  const r = await projectFinancialResult(
    people.owner,
    fixture.project.id,
    baseRange,
  );
  expect(r.values).toMatchObject({
    recognizedIncome: "300000.00",
    directCosts: "120000.00",
    contribution: "180000.00",
    fullyAllocatedResult: "180000.00",
    cashMovement: "110000.00",
  });
  const rows = await rollforward(people.owner, "PROJECTS", baseRange);
  expect(
    rows.items.find(
      (x) => x.entityId === fixture.project.id && x.metric === "NET_RESULT",
    )?.closingBalance,
  ).toBe("180000.00");
});
it("retains exact source drill-down, current private permissions and independently matching totals for every actual entry", async () => {
  for (const id of fixture.journalIds) {
    const r = await postedSource(people.selected, { id });
    expect(r.difference).toBe("0.00");
    expect(r.entry.sourceId).toBeTruthy();
    expect(r.items.length).toBeGreaterThanOrEqual(2);
  }
  for (const who of ["other", "hr", "lead", "member"])
    await expect(
      balanceSheet(people[who], { asOf: baseRange.to }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  expect(
    (await trialBalance(people.owner, { ...baseRange, q: "nothing matches" }))
      .companyTotals.periodDebit,
  ).toBe("1445000.00");
});

const { customerCommand } =
    await import("@/modules/finance/receivables/customer/service"),
  { movementCommand } = await import("@/modules/finance/treasury/service"),
  { invoiceCommand } = await import("@/modules/finance/receivables/service"),
  { cashFlowReview, cashFlowConfirm } =
    await import("@/modules/finance/reports/cash-flow/service");
const invoke = async <T>(
  fn: (v: Awaited<ReturnType<typeof proof>>) => Promise<T>,
) => fn(await proof());
async function classify(
  journalId: string,
  category: "OPERATING" | "INVESTING" | "FINANCING" | "INTERNAL",
) {
  const data = await cashFlowReview(people.owner, { journalId });
  return invoke((v) =>
    cashFlowConfirm(
      v.actor,
      v.proof,
      {
        journalId,
        basisHash: data.basisHash,
        expectedReviewId: null,
        expectedVersion: null,
        components: data.lines.map((l) => ({
          journalLineId: l.id,
          category,
          amount: l.amount,
        })),
        evidence: "Explicit acceptance follow-up source classification",
        reason: "Review actual cash purpose without posting again",
      },
      crypto.randomUUID(),
    ),
  );
}
let originalDigest: string;
it("retains the known base report digest before independent follow-up activity", async () => {
  originalDigest = (await trialBalance(people.owner, baseRange)).metadata
    .ledgerDigest;
  expect(originalDigest).toMatch(/^[a-f0-9]{64}$/);
  const tb = await trialBalance(people.owner, baseRange),
    pl = await profitLoss(people.owner, baseRange),
    bs = await balanceSheet(people.owner, { asOf: baseRange.to }),
    cash = await cashFlow(people.owner, baseRange),
    project = await projectFinancialResult(
      people.owner,
      fixture.project.id,
      baseRange,
    );
  const sourceHashes: Record<string, string> = {};
  for (const path of [
    "tests/fixtures/finance-acceptance.ts",
    "src/modules/finance/projects/costs/service.ts",
  ])
    sourceHashes[path] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  await writeFile(
    ".local/finance/f43-acceptance-evidence.json",
    JSON.stringify(
      {
        kind: "SYNTHETIC_ACCEPTANCE_ONLY",
        capturedAt: new Date().toISOString(),
        period: baseRange,
        assumptions: {
          currency: "PKR",
          opening: "zero",
          tax: "none",
          depreciation: "none",
          overheadAllocation: "none",
          services: "earned on original invoice",
          cashClassification: "explicit synthetic owner review",
        },
        sourceHashes,
        journalCount: await db.financeJournalEntry.count(),
        trialBalance: tb.companyTotals,
        profitLoss: pl.sections,
        balanceSheet: bs.sections,
        cashFlow: {
          opening: cash.openingBalance,
          closing: cash.closingBalance,
          categories: cash.categories,
          difference: cash.difference,
          classificationReady: cash.classificationReady,
        },
        project: project.values,
        ledgerDigest: originalDigest,
        documents: await db.financeJournalEntry.findMany({
          orderBy: [{ postingDate: "asc" }, { id: "asc" }],
          select: {
            id: true,
            reference: true,
            sourceType: true,
            sourceId: true,
            postingDate: true,
          },
        }),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  expect((await profitLoss(people.owner, baseRange)).sections.netProfit).toBe(
    "180000.00",
  );
});
it("receives and replays a50,000 client advance once while keeping profit and receivables unchanged", async () => {
  const body = {
      reference: "F43-CLIENT-ADVANCE",
      partyId: fixture.client,
      cashAccountId: fixture.bank,
      advanceAccountId: fixture.accounts.clientAdvance,
      projectId: fixture.project.id,
      documentDate: "2020-01-20",
      postingDate: "2020-01-20",
      description: "Independent client advance follow-up",
      evidence: "Acceptance advance bank evidence",
      cashAmount: "50000.00",
      allocations: [],
      reason: "Receive unearned client funds",
    },
    createKey = crypto.randomUUID(),
    postKey = crypto.randomUUID(),
    count = await db.financeJournalEntry.count();
  const create = () =>
      invoke((v) =>
        customerCommand(v.actor, v.proof, "RECEIPT", "CREATE", body, createKey),
      ),
    draft = await create();
  expect((await create()).id).toBe(draft.id);
  const input = {
      id: draft.id,
      expectedVersion: draft.version,
      reason: "Post actual client advance once",
    },
    post = () =>
      invoke((v) =>
        customerCommand(v.actor, v.proof, "RECEIPT", "POST", input, postKey),
      ),
    posted = await post();
  expect(await post()).toEqual(posted);
  expect(await db.financeJournalEntry.count()).toBe(count + 1);
  await classify(posted.journalId!, "OPERATING");
  expect(
    (
      await generalLedger(people.owner, {
        from: baseRange.from,
        to: "2020-01-20",
        accountId: fixture.accounts.bank,
      })
    ).closingBalance,
  ).toBe("625000.00");
  expect(
    (await profitLoss(people.owner, { from: baseRange.from, to: "2020-01-20" }))
      .sections.netProfit,
  ).toBe("180000.00");
  expect(
    (
      await sql.query(
        'SELECT sum(amount)::text AS n FROM "FinanceReceivableEvent" WHERE "invoiceId"=$1',
        [fixture.invoice.id],
      )
    ).rows[0].n,
  ).toBe("100000.00");
  expect(
    (
      await sql.query(
        'SELECT sum(amount)::text AS n FROM "FinanceClientBalanceEvent" WHERE "sourceDocumentId"=$1',
        [draft.id],
      )
    ).rows[0].n,
  ).toBe("50000.00");
});
it("transfers and replays20,000 internally once while company cash and profit stay unchanged", async () => {
  const createKey = crypto.randomUUID(),
    postKey = crypto.randomUUID(),
    body = {
      kind: "TRANSFER",
      reference: "F43-INTERNAL-TRANSFER",
      documentDate: "2020-01-21",
      postingDate: "2020-01-21",
      fromCashId: fixture.bank,
      toCashId: fixture.petty,
      amount: "20000.00",
      description: "Independent internal cash movement",
      evidence: "Both synthetic cash sides reviewed",
      reason: "Transfer cash without income or expense",
    },
    count = await db.financeJournalEntry.count();
  const create = () =>
      invoke((v) =>
        movementCommand(v.actor, v.proof, "CREATE", body, createKey),
      ),
    draft = await create();
  expect((await create()).id).toBe(draft.id);
  const input = {
      id: draft.id,
      expectedVersion: draft.version,
      reason: "Post exact internal transfer once",
    },
    post = () =>
      invoke((v) => movementCommand(v.actor, v.proof, "POST", input, postKey)),
    posted = await post();
  expect(await post()).toEqual(posted);
  expect(await db.financeJournalEntry.count()).toBe(count + 1);
  await classify(posted.journalId!, "INTERNAL");
  const range = { from: baseRange.from, to: "2020-01-21" };
  expect(
    (
      await generalLedger(people.owner, {
        ...range,
        accountId: fixture.accounts.bank,
      })
    ).closingBalance,
  ).toBe("605000.00");
  expect(
    (
      await generalLedger(people.owner, {
        ...range,
        accountId: fixture.accounts.petty,
      })
    ).closingBalance,
  ).toBe("20000.00");
  expect(await cashFlow(people.owner, range)).toMatchObject({
    closingBalance: "625000.00",
    internalNet: "0.00",
    difference: "0.00",
    classificationReady: true,
  });
  expect((await profitLoss(people.owner, range)).sections.netProfit).toBe(
    "180000.00",
  );
});
it("credits and replays30,000 against the original unpaid invoice once without moving cash", async () => {
  const source = await db.financeInvoiceLine.findFirstOrThrow({
      where: { invoiceId: fixture.invoice.id },
    }),
    body = {
      reference: "F43-ORIGINAL-CREDIT",
      partyId: fixture.client,
      invoiceId: fixture.invoice.id,
      advanceAccountId: fixture.accounts.clientAdvance,
      projectId: fixture.project.id,
      documentDate: "2020-01-22",
      postingDate: "2020-01-22",
      description: "Independent original service credit",
      evidence: "Original unpaid service credit evidence",
      creditLines: [{ invoiceLineId: source.id, amount: "30000.00" }],
      reason: "Credit original earned service once",
    },
    createKey = crypto.randomUUID(),
    postKey = crypto.randomUUID(),
    count = await db.financeJournalEntry.count();
  const create = () =>
      invoke((v) =>
        customerCommand(
          v.actor,
          v.proof,
          "CUSTOMER_CREDIT",
          "CREATE",
          body,
          createKey,
        ),
      ),
    draft = await create();
  expect((await create()).id).toBe(draft.id);
  const input = {
      id: draft.id,
      expectedVersion: draft.version,
      reason: "Post evidenced original service credit",
    },
    post = () =>
      invoke((v) =>
        customerCommand(
          v.actor,
          v.proof,
          "CUSTOMER_CREDIT",
          "POST",
          input,
          postKey,
        ),
      ),
    posted = await post();
  expect(await post()).toEqual(posted);
  expect(await db.financeJournalEntry.count()).toBe(count + 1);
  const range = { from: baseRange.from, to: "2020-01-22" };
  expect((await profitLoss(people.owner, range)).sections).toMatchObject({
    revenue: "270000.00",
    directCosts: "120000.00",
    netProfit: "150000.00",
  });
  expect(
    (
      await generalLedger(people.owner, {
        ...range,
        accountId: fixture.accounts.ar,
      })
    ).closingBalance,
  ).toBe("70000.00");
  expect((await cashFlow(people.owner, range)).closingBalance).toBe(
    "625000.00",
  );
  expect(
    (await balanceSheet(people.owner, { asOf: range.to })).sections,
  ).toMatchObject({
    totalAssets: "805000.00",
    totalLiabilities: "155000.00",
    totalEquity: "650000.00",
    difference: "0.00",
  });
  expect(
    (await trialBalance(people.owner, baseRange)).metadata.ledgerDigest,
  ).toBe(originalDigest);
  expect((await profitLoss(people.owner, baseRange)).sections.netProfit).toBe(
    "180000.00",
  );
});
let roundingInvoice: string;
async function postRoundedInvoice(
  reference: string,
  lines: Record<string, unknown>[],
) {
  const d = await invoke((v) =>
    invoiceCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        reference,
        partyId: fixture.client,
        receivableAccountId: fixture.accounts.ar,
        invoiceDate: "2020-01-25",
        postingDate: "2020-01-25",
        dueDate: "2020-01-31",
        description: "Independent exact rounding source",
        evidence: "Acceptance line-level rounding evidence",
        lines: lines.map((l) => ({
          description: "Actual fractional quantity/rate",
          recognition: "EARNED",
          revenueAccountId: fixture.accounts.revenue,
          ...l,
        })),
        reason: "Create exact fractional acceptance invoice",
      },
      crypto.randomUUID(),
    ),
  );
  await invoke((v) =>
    invoiceCommand(
      v.actor,
      v.proof,
      "POST",
      {
        id: d.id,
        expectedVersion: d.version,
        reason: "Post exact rounded lines",
      },
      crypto.randomUUID(),
    ),
  );
  return d.id;
}
it("rounds real fractional quantity/rate postings to exact paisa at each line", async () => {
  const id = await postRoundedInvoice("F43-FRACTIONAL", [
      { quantity: "0.1", unitRate: "0.2" },
      { quantity: "0.3", unitRate: "0.3" },
      { quantity: "0.01", unitRate: "0.5" },
    ]),
    invoice = await db.financeInvoice.findUniqueOrThrow({
      where: { id },
      include: { lines: { orderBy: { sequence: "asc" } } },
    });
  expect(invoice.totalAmount.toFixed(2)).toBe("0.12");
  expect(invoice.lines.map((l) => l.totalAmount.toFixed(2))).toEqual([
    "0.02",
    "0.09",
    "0.01",
  ]);
  expect(
    (
      await sql.query(
        'SELECT sum(amount)::text AS n FROM "FinanceReceivableEvent" WHERE "invoiceId"=$1',
        [id],
      )
    ).rows[0].n,
  ).toBe("0.12");
});
it("sums three half-paisa lines as100.02 and preserves that exact posted receivable", async () => {
  roundingInvoice = await postRoundedInvoice(
    "F43-HALF-PAISA",
    Array.from({ length: 3 }, () => ({ quantity: "1", unitRate: "33.335" })),
  );
  const d = await db.financeInvoice.findUniqueOrThrow({
    where: { id: roundingInvoice },
    include: { lines: true },
  });
  expect(d.lines.map((l) => l.totalAmount.toFixed(2))).toEqual([
    "33.34",
    "33.34",
    "33.34",
  ]);
  expect(d.totalAmount.toFixed(2)).toBe("100.02");
});
it("serializes competing rounded credits so only one60.01 source posts against the same100.02 invoice", async () => {
  const lines = await db.financeInvoiceLine.findMany({
      where: { invoiceId: roundingInvoice },
      orderBy: { sequence: "asc" },
    }),
    make = (reference: string) =>
      invoke((v) =>
        customerCommand(
          v.actor,
          v.proof,
          "CUSTOMER_CREDIT",
          "CREATE",
          {
            reference,
            partyId: fixture.client,
            invoiceId: roundingInvoice,
            advanceAccountId: fixture.accounts.clientAdvance,
            documentDate: "2020-01-26",
            postingDate: "2020-01-26",
            description: "Competing exact rounded credit",
            evidence: "Exact independent credit source",
            creditLines: [
              { invoiceLineId: lines[0].id, amount: "33.34" },
              { invoiceLineId: lines[1].id, amount: "26.67" },
            ],
            reason: "Prepare competing rounded credit",
          },
          crypto.randomUUID(),
        ),
      ),
    a = await make("F43-COMPETING-A"),
    b = await make("F43-COMPETING-B"),
    count = await db.financeJournalEntry.count();
  const results = await Promise.allSettled(
    [a, b].map((d) =>
      invoke((v) =>
        customerCommand(
          v.actor,
          v.proof,
          "CUSTOMER_CREDIT",
          "POST",
          {
            id: d.id,
            expectedVersion: d.version,
            reason: "Post within original line capacity",
          },
          crypto.randomUUID(),
        ),
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await db.financeJournalEntry.count()).toBe(count + 1);
  expect(
    (
      await sql.query(
        'SELECT sum(amount)::text AS n FROM "FinanceReceivableEvent" WHERE "invoiceId"=$1',
        [roundingInvoice],
      )
    ).rows[0].n,
  ).toBe("40.01");
  expect(
    (
      await trialBalance(people.owner, {
        from: baseRange.from,
        to: "2020-01-31",
      })
    ).companyTotals.closingDifference,
  ).toBe("0.00");
});
it("refuses to seed over retained financial journals without changing source or chart history", async () => {
  const journals = await db.financeJournalEntry.count(),
    accounts = await db.financeAccount.count();
  await expect(seedAccountingAcceptance(proof)).rejects.toThrow(
    "zero opening journals",
  );
  expect(await db.financeJournalEntry.count()).toBe(journals);
  expect(await db.financeAccount.count()).toBe(accounts);
});
it("rejects a nonlocal production-shaped fixture target before any database access", async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    "postgresql://synthetic:synthetic@hosted.example.test:5432/postgres";
  try {
    await expect(seedAccountingAcceptance(proof)).rejects.toThrow(
      "isolated loopback encova_test",
    );
  } finally {
    process.env.DATABASE_URL = previous;
  }
});
