import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("posted ledger carries second-page balances, opens real source and preserves company trial totals with private mobile access", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.ledger.reports",
    ),
    prefix = "LR33." + crypto.randomUUID().slice(0, 6).toUpperCase(),
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
    for (let n = 0; n < 27; n++) {
      const m = await command("encova_finance_movement_command", "CREATE", {
        kind: "TRANSFER",
        currency: "PKR",
        feeAmount: "0.00",
        allocations: [],
        reference: prefix + " item " + n,
        fromCashId: banks[1].id,
        toCashId: banks[0].id,
        amount: "1.00",
        documentDate: period.end,
        postingDate: period.end,
        description: "Actual report movement " + n,
        evidence: "Synthetic actual cash source",
        reason: "Create real posted report fixture",
      });
      await command("encova_finance_movement_command", "POST", {
        id: m.id,
        expectedVersion: m.version,
        reason: "Explicit actual report cash posting",
      });
    }
    const before = (
      await f.sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"')
    ).rows[0].n;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/finance/reports/general-ledger");
    await page
      .getByLabel("Posting start date", { exact: true })
      .fill(period.end);
    await page.getByLabel("Posting end date", { exact: true }).fill(period.end);
    await page
      .getByLabel("Search ledger account", { exact: true })
      .fill(prefix + ".B");
    const account = page.getByLabel("Ledger account", { exact: true });
    await expect(
      account.getByRole("option").filter({ hasText: prefix }),
    ).toHaveCount(1);
    await account.selectOption(bgl.id);
    await page
      .getByRole("button", { name: "Show general ledger", exact: true })
      .click();
    const totals = page.getByRole("region", {
      name: "Ledger account totals",
      exact: true,
    });
    await expect(totals).toContainText("PKR 10.01 DR");
    await expect(totals).toContainText("PKR 37.01 DR");
    const table = page.getByRole("region", {
      name: "General ledger movements",
      exact: true,
    });
    await expect(table.getByRole("row")).toHaveCount(26);
    await expect(
      table.getByRole("row").last().getByRole("cell").last(),
    ).toHaveText("PKR 35.01 DR");
    await table.focus();
    await expect(table).toBeFocused();
    await page
      .getByRole("link", { name: "Next ledger page", exact: true })
      .click();
    await expect(page).toHaveURL(/page=2/);
    const second = page.getByRole("region", {
      name: "General ledger movements",
      exact: true,
    });
    await expect(second.getByRole("row")).toHaveCount(3);
    await expect(
      second.getByRole("row").last().getByRole("cell").last(),
    ).toHaveText("PKR 37.01 DR");
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await second.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/finance\/movements\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("region", { name: "Movement preview", exact: true }),
    ).toContainText("Actual report movement");
    await page.goto(
      "/finance/reports/trial-balance?" +
        new URLSearchParams({ from: period.end, to: period.end }),
    );
    await page
      .getByLabel("Filter displayed accounts", { exact: true })
      .fill(prefix + ".B");
    await page
      .getByRole("button", { name: "Show trial balance", exact: true })
      .click();
    const trial = page.getByRole("region", {
      name: "Trial balance account rows",
      exact: true,
    });
    await expect(trial.getByRole("row")).toHaveCount(2);
    await expect(trial.getByRole("row").last()).toContainText("PKR 10.01");
    await expect(trial.getByRole("row").last()).toContainText("PKR 37.01");
    const company = page.getByRole("region", {
      name: "Complete company trial balance",
      exact: true,
    });
    await expect(company).toContainText(
      "Search, zero-account display and pagination affect the displayed rows only",
    );
    await expect(
      company
        .locator("dl > div")
        .filter({ has: page.locator("dt", { hasText: "Closing difference" }) }),
    ).toContainText("PKR 0.00");
    await trial.getByRole("link").click();
    await expect(page).toHaveURL(/\/finance\/reports\/general-ledger\?/);
    await expect(
      page.getByRole("region", { name: "Ledger account totals", exact: true }),
    ).toContainText("PKR 37.01");
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
      "/api/v1/finance/reports/general-ledger?" +
        new URLSearchParams({
          accountId: bgl.id,
          from: period.start,
          to: period.end,
        }),
    );
    expect([403, 404]).toContain(denied.status());
    expect(denied.headers()["cache-control"]).toContain("no-store");
  } finally {
    await Promise.allSettled([lower.close()]);
    await f.close();
  }
});
