import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("bank reconciliation documents partial cash, retains finalized proof and owner reopening, with mobile/permission checks", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.reconciliation",
    ),
    prefix = "RC32." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    lower = await browser.newContext();
  try {
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const command = async (fn: string, action: string, input: unknown) =>
      (
        await f.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS result`,
          [
            f.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].result;
    const bgl = await f.seedAccount(prefix + ".B", { controlType: "CASH" }),
      fgl = await f.seedAccount(prefix + ".F", { controlType: "CASH" }),
      banks = [];
    for (const [i, gl] of [bgl, fgl].entries())
      banks.push(
        await command("encova_finance_master_command", "CASH_CREATE", {
          name: prefix + " bank " + i,
          kind: "BANK",
          currency: "PKR",
          glAccountId: gl.id,
          maskedReference: "1234",
          reason: "Isolated matching bank mapping",
        }),
      );
    const period = await f.historicalPeriod(prefix + " match dates");
    const draft = await command("encova_finance_movement_command", "CREATE", {
      kind: "TRANSFER",
      currency: "PKR",
      feeAmount: "0.00",
      allocations: [],
      reference: prefix + " transfer",
      fromCashId: banks[1].id,
      toCashId: banks[0].id,
      amount: "10.01",
      documentDate: period.start,
      postingDate: period.start,
      description: "Reviewed synthetic actual cash",
      evidence: "Retained synthetic source",
      reason: "Create synthetic actual transfer",
    });
    await command("encova_finance_movement_command", "POST", {
      id: draft.id,
      expectedVersion: draft.version,
      reason: "Explicit synthetic cash posting",
    });
    const bytes = Buffer.from(
        "Date,Amount,Description\n" +
          period.end +
          ",4.00,Synthetic bank deposit\n",
      ),
      sha = createHash("sha256").update(bytes).digest("hex"),
      intent = createHash("sha256").update(crypto.randomUUID()).digest("hex"),
      upload = await command("encova_finance_statement_command", "RESERVE", {
        cashAccountId: banks[0].id,
        fileName: "match.csv",
        byteSize: bytes.length,
        sha256: sha,
        intentHash: intent,
        reason: "Retained isolated bank source",
      });
    await f.sql.query("SELECT encova_finance_statement_transport($1,$2)", [
      f.owner.id,
      JSON.stringify({
        id: upload.uploadId,
        index: 0,
        content: bytes.toString("base64"),
        sha256: sha,
        intentHash: intent,
      }),
    ]);
    const metadata = {
        mapping: {
          mode: "SIGNED",
          skipRows: 0,
          dateColumn: 0,
          dateFormat: "ISO",
          amountColumn: 1,
          positiveMeans: "RECEIPT",
          descriptionColumn: 2,
          referenceColumn: null,
        },
        startDate: period.start,
        endDate: period.end,
        openingBalance: "0.00",
        closingBalance: "4.00",
        currency: "PKR",
      },
      rows = [
        {
          sequence: 1,
          sourceRow: 2,
          valueDate: period.end,
          direction: "RECEIPT",
          amount: "4.00",
          description: "Synthetic bank deposit",
          bankReference: "",
        },
      ],
      preview = (
        await f.sql.query(
          "SELECT encova_finance_statement_preview($1,$2) AS result",
          [f.owner.id, JSON.stringify({ id: upload.uploadId, metadata, rows })],
        )
      ).rows[0].result;
    const imported = await command(
      "encova_finance_statement_command",
      "IMPORT",
      {
        id: upload.uploadId,
        ...metadata,
        rows,
        expectedVersion: preview.uploadVersion,
        basisHash: preview.basisHash,
        acknowledgedRows: [],
        duplicateReview: "",
        reason: "Explicit reviewed synthetic import",
      },
    );
    const before = (
      await f.sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"')
    ).rows[0].n;
    const statement = (
        await f.sql.query(
          'SELECT id FROM "FinanceStatementLine" WHERE "batchId"=$1',
          [imported.id],
        )
      ).rows[0],
      cash = (
        await f.sql.query(
          'SELECT l.id FROM "FinanceJournalLine" l JOIN "FinanceJournalEntry" e ON e.id=l."journalId" WHERE e."movementId"=$1 AND l."accountId"=$2',
          [draft.id, bgl.id],
        )
      ).rows[0],
      allocations = [
        {
          statementLineId: statement.id,
          journalLineId: cash.id,
          amount: "4.00",
        },
      ],
      match = (
        await f.sql.query(
          "SELECT encova_finance_bank_match_preview($1,$2) AS result",
          [
            f.owner.id,
            JSON.stringify({ cashAccountId: banks[0].id, allocations }),
          ],
        )
      ).rows[0].result;
    await command("encova_finance_bank_match_command", "MATCH", {
      cashAccountId: banks[0].id,
      allocations,
      basisHash: match.basisHash,
      description: "Actual partial deposit in bank",
      evidence: "Retained bank amount versus actual cash",
      reason: "Reviewed synthetic partial association",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/finance/reconciliations/new");
    await page
      .getByLabel("Search reconciliation bank", { exact: true })
      .fill(prefix + " bank 0");
    const bank = page.getByLabel("Reconciliation bank", { exact: true });
    await expect(
      bank.getByRole("option").filter({ hasText: prefix }),
    ).toHaveCount(1);
    await bank.selectOption(banks[0].id);
    const source = page.getByLabel("Statement source", { exact: true });
    await expect(source.getByRole("option")).toHaveCount(2);
    await source.selectOption(imported.id);
    const form = (name: string) =>
      page
        .locator("form")
        .filter({ has: page.getByRole("button", { name, exact: true }) });
    const authorize = async (name: string) => {
      const region = form(name);
      await region
        .getByLabel("Reason", { exact: true })
        .fill("Explicit source-to-GL bank reconciliation review");
      await region
        .getByLabel("Current password", { exact: true })
        .fill(f.password);
      await region.getByRole("button", { name, exact: true }).click();
    };
    await page
      .getByLabel("Review evidence", { exact: true })
      .fill(
        "Bank closes at4.00; actual received cash10.01 with6.01 deposit in transit",
      );
    await authorize("Create reconciliation review");
    await expect(page).toHaveURL(/\/finance\/reconciliations\/[0-9a-f-]+$/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const proof = page.getByRole("region", {
      name: "Reconciliation proof",
      exact: true,
    });
    await expect(proof).toContainText("6.01");
    await expect(proof).toContainText("1 undocumented cash items");
    await expect(
      page.getByRole("button", {
        name: "Finalize reconciliation",
        exact: true,
      }),
    ).toBeDisabled();
    const notes = page.getByRole("region", {
      name: "Outstanding reconciliation items",
      exact: true,
    });
    await notes
      .getByLabel("Documentation for item 1", { exact: true })
      .fill(
        "Remaining6.01 deposit in transit will appear on the next bank statement",
      );
    await authorize("Save this page’s item reviews");
    await expect(
      page.getByText("DRAFT · version 2", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Finalize reconciliation",
        exact: true,
      }),
    ).toBeEnabled();
    await authorize("Finalize reconciliation");
    await expect(
      page.getByText("FINALIZED · version 3", { exact: false }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const retained = (
      await f.sql.query(
        'SELECT "finalSnapshot" FROM "FinanceReconciliation" WHERE id=$1',
        [id],
      )
    ).rows[0].finalSnapshot;
    await authorize("Reopen bank reconciliation");
    await expect(
      page.getByText("REOPENED · version 4", { exact: false }),
    ).toBeVisible();
    expect(
      (
        await f.sql.query(
          'SELECT "finalSnapshot" FROM "FinanceReconciliation" WHERE id=$1',
          [id],
        )
      ).rows[0].finalSnapshot,
    ).toEqual(retained);
    await page
      .getByRole("link", {
        name: "Create linked replacement review",
        exact: true,
      })
      .click();
    const replacementSource = page.getByLabel("Statement source", {
      exact: true,
    });
    await expect(replacementSource.getByRole("option")).toHaveCount(2);
    await replacementSource.selectOption(imported.id);
    await authorize("Create reconciliation review");
    await expect(page).toHaveURL(/\/finance\/reconciliations\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("link", { name: /Original REC-/ }),
    ).toHaveAttribute("href", "/finance/reconciliations/" + id);
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(before);
    const lp = await lower.newPage();
    await login(lp, "e2e.finance.commercial.manager@example.test");
    const denied = await lp.request.get(
      "/api/v1/finance/reconciliations/" + id,
    );
    expect([403, 404]).toContain(denied.status());
    expect(denied.headers()["cache-control"]).toContain("no-store");
  } finally {
    await Promise.allSettled([lower.close()]);
    await f.close();
  }
});
