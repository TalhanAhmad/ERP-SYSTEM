import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("explicit matching recovers excess amounts, confirms actual dates and retains opposite unmatch on mobile with role isolation", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.matching",
    ),
    prefix = "BM31." + crypto.randomUUID().slice(0, 6).toUpperCase(),
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
          ",10.01,Synthetic bank deposit\n",
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
        closingBalance: "10.01",
        currency: "PKR",
      },
      rows = [
        {
          sequence: 1,
          sourceRow: 2,
          valueDate: period.end,
          direction: "RECEIPT",
          amount: "10.01",
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
    await command("encova_finance_statement_command", "IMPORT", {
      id: upload.uploadId,
      ...metadata,
      rows,
      expectedVersion: preview.uploadVersion,
      basisHash: preview.basisHash,
      acknowledgedRows: [],
      duplicateReview: "",
      reason: "Explicit reviewed synthetic import",
    });
    const before = (
      await f.sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"')
    ).rows[0].n;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/finance/bank-matches/new");
    await page
      .getByLabel("Search bank account", { exact: true })
      .fill(prefix + " bank 0");
    const bank = page.getByLabel("Bank account", { exact: true });
    await expect(
      bank.getByRole("option").filter({ hasText: prefix }),
    ).toHaveCount(1);
    await bank.selectOption(banks[0].id);
    const statement = page.getByLabel("Statement record", { exact: true }),
      cash = page.getByLabel("Posted cash entry", { exact: true });
    await expect(statement.getByRole("option")).toHaveCount(2);
    await expect(cash.getByRole("option")).toHaveCount(2);
    await statement.selectOption({ index: 1 });
    await cash.selectOption({ index: 1 });
    await page
      .getByLabel("Allocation amount (PKR)", { exact: true })
      .fill("10.02");
    await page
      .getByRole("button", { name: "Add allocation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review matching preview", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Proposed allocations" }),
    ).toContainText("exceed");
    await page
      .getByRole("button", { name: "Remove allocation 1", exact: true })
      .click();
    await page
      .getByLabel("Allocation amount (PKR)", { exact: true })
      .fill("10.01");
    await page
      .getByRole("button", { name: "Add allocation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review matching preview", exact: true })
      .click();
    const review = page.getByRole("region", {
      name: "Reviewed matching preview",
      exact: true,
    });
    await expect(review).toContainText(period.start + " cash");
    await expect(review).toContainText(period.end + " bank");
    await review
      .getByLabel("Description", { exact: true })
      .fill("Explicit actual bank match");
    await review
      .getByLabel("Matching evidence", { exact: true })
      .fill("Bank value date and actual GL source reviewed");
    await review
      .getByLabel("Reason", { exact: true })
      .fill("Confirm reviewed bank associations");
    await review
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await review
      .getByRole("button", { name: "Confirm bank matching", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/bank-matches\/[0-9a-f-]+$/);
    const path = new URL(page.url()).pathname;
    await expect(
      page.getByRole("heading", {
        name: "Reviewed matching group",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("MATCHED · version 2", { exact: false }),
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
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Correct association without deleting history");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Confirm unmatch", exact: true })
      .click();
    await expect(
      page.getByText("UNMATCHED · version 3", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm unmatch", exact: true }),
    ).toHaveCount(0);
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
      "/api/v1/finance/bank-matches/" + path.split("/").at(-1),
    );
    expect([403, 404]).toContain(denied.status());
    expect(denied.headers()["cache-control"]).toContain("no-store");
  } finally {
    await Promise.allSettled([lower.close()]);
    await f.close();
  }
});
