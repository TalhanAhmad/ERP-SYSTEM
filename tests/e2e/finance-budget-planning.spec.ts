import { test, expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("approved budget revisions retain prior plans, unpaid actuals are advisory, and selected-only forecasts never record cash", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.planning",
    ),
    p = "BP29." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    writer = await browser.newContext(),
    manager = await browser.newContext();
  let writerId: string | undefined;
  const authorize = async (form: Locator, label: string) => {
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Explicit reviewed planning action");
    await form.getByLabel("Current password", { exact: true }).fill(f.password);
    await form.getByRole("button", { name: label, exact: true }).click();
  };
  try {
    const period = await f.historicalPeriod(p),
      session = (
        await f.sql.query(
          'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
          [f.owner.authUserId],
        )
      ).rows[0];
    const seed = async (
      fn: string,
      action: string,
      input: Record<string, unknown>,
    ) =>
      (
        await f.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4::jsonb,$5,$6) AS result`,
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
    const expense = await f.seedAccount(p + ".COST", {
        type: "DIRECT_COST",
        normalSide: "DEBIT",
        reportGroup: "DIRECT_COSTS",
      }),
      offset = await f.seedAccount(p + ".ACCRUAL", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
      }),
      lead = (
        await f.sql.query('SELECT id FROM "Person" WHERE username=$1', [
          "e2e.finance.commercial.manager",
        ])
      ).rows[0],
      projectId = crypto.randomUUID();
    await f.sql.query(
      'INSERT INTO "Project"(id,name,description,"managerId","updatedAt") VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [projectId, p + " project", "Ordinary delivery workspace", lead.id],
    );
    const original = await seed("encova_finance_ledger_command", "CREATE", {
      reference: p,
      postingDate: period.start,
      description: p + " incurred cost",
      evidence: "Reviewed incurred accrual",
      currency: "PKR",
      lines: [
        {
          accountId: expense.id,
          description: "Incurred direct cost",
          debit: "120.00",
          credit: "0.00",
          projectId,
        },
        {
          accountId: offset.id,
          description: "Unpaid accrued cost",
          debit: "0.00",
          credit: "120.00",
          projectId,
        },
      ],
      reason: "Recognize incurred cost independently of budget",
    });
    await seed("encova_finance_ledger_command", "POST", {
      id: original.id,
      expectedVersion: 1,
      reason: "Post actual incurred source",
    });
    const before = (
      await f.sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"')
    ).rows[0].n;
    await page.goto("/finance/budgets/new?projectId=" + projectId);
    await page
      .getByLabel("Budget month", { exact: true })
      .fill(period.start.slice(0, 7));
    await page
      .getByLabel("Search expense account 1", { exact: true })
      .fill(p + ".COST");
    await expect(
      page
        .getByLabel("Expense account 1", { exact: true })
        .getByRole("option")
        .filter({ hasText: p + ".COST" }),
    ).toHaveCount(1);
    await page
      .getByLabel("Expense account 1", { exact: true })
      .selectOption(expense.id);
    await page
      .getByLabel("Budget line 1 amount (PKR)", { exact: true })
      .fill("100.01");
    await page
      .getByLabel("Description", { exact: true })
      .fill(p + " monthly expense plan");
    await page
      .getByLabel("Planning evidence", { exact: true })
      .fill("Reviewed month and project cost plan");
    await authorize(page.locator("form"), "Create budget draft");
    await expect(page.getByRole("heading", { name: /^BGT-/ })).toBeVisible();
    const firstId = page.url().split("/").pop();
    let approval = page.getByRole("region", {
      name: "APPROVE budget",
      exact: true,
    });
    await approval
      .getByLabel("Approval evidence", { exact: true })
      .fill("Approved first monthly plan");
    await authorize(approval.locator("form"), "Approve budget");
    await expect(
      page.getByRole("link", { name: "Start budget revision", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", {
        name: "Compare approved budget with actuals",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", { name: "Budget variance result", exact: true }),
    ).toContainText("-19.99");
    await expect(
      page.getByRole("region", { name: "Budget variance result", exact: true }),
    ).toContainText("Above approved budget");
    await page.goto("/finance/budgets/" + firstId);
    await page
      .getByRole("link", { name: "Start budget revision", exact: true })
      .click();
    await page
      .getByLabel("Budget line 1 amount (PKR)", { exact: true })
      .fill("130.03");
    await authorize(page.locator("form"), "Create budget revision");
    await expect(page.getByRole("heading", { name: /^BGT-/ })).toBeVisible();
    const secondId = page.url().split("/").pop();
    expect(secondId).not.toBe(firstId);
    const current = await page.request.get(
      "/api/v1/finance/budget-variance?" +
        new URLSearchParams({ month: period.start.slice(0, 7), projectId }),
    );
    expect((await current.json()).data.budget.id).toBe(firstId);
    approval = page.getByRole("region", {
      name: "APPROVE budget",
      exact: true,
    });
    await approval
      .getByLabel("Approval evidence", { exact: true })
      .fill("Approved replacement monthly plan");
    await authorize(approval.locator("form"), "Approve budget");
    await expect(
      page.getByRole("link", { name: "Start budget revision", exact: true }),
    ).toBeVisible();
    const old = await page.request.get("/api/v1/finance/budgets/" + firstId);
    expect((await old.json()).data.item).toMatchObject({
      state: "SUPERSEDED",
      total: "100.01",
    });
    expect(old.headers()["cache-control"]).toContain("no-store");
    writerId = (
      await f.sql.query('SELECT id FROM "Person" WHERE username=$1', [
        "e2e.finance.planning.writer",
      ])
    ).rows[0].id;
    await f.sql.query(
      'DELETE FROM "FinanceGrant" WHERE "userId"=$1 AND "grantedById"=$2 AND reason=$3',
      [writerId, f.owner.id, "Explicit isolated forecast tester"],
    );
    await f.sql.query(
      'INSERT INTO "FinanceGrant"(id,"userId","grantedById",reason) VALUES(gen_random_uuid(),$1,$2,$3)',
      [writerId, f.owner.id, "Explicit isolated forecast tester"],
    );
    const w = await writer.newPage();
    await login(w, "e2e.finance.planning.writer@example.test");
    await w.goto("/finance/forecasts/new?projectId=" + projectId);
    await w
      .getByLabel("Expected cash direction", { exact: true })
      .selectOption("PAYMENT");
    await w
      .getByLabel("Expected cash date", { exact: true })
      .fill("2099-12-31");
    await w.getByLabel("Expected amount (PKR)", { exact: true }).fill("200.01");
    await w.getByLabel("Likelihood", { exact: true }).selectOption("LIKELY");
    await w
      .getByLabel("Likelihood note", { exact: true })
      .fill("Supplier quotation still under review");
    await w
      .getByLabel("Description", { exact: true })
      .fill(p + " expected supplier cash");
    await w
      .getByLabel("Forecast evidence", { exact: true })
      .fill("Expected purchase plan only");
    await authorize(w.locator("form"), "Create cash forecast");
    await expect(w.getByRole("heading", { name: /^FCT-/ })).toBeVisible();
    const id = w.url().split("/").pop();
    await w.getByLabel("Expected amount (PKR)", { exact: true }).fill("200.02");
    await authorize(
      w.locator("form").filter({
        has: w.getByRole("button", {
          name: "Save cash forecast",
          exact: true,
        }),
      }),
      "Save cash forecast",
    );
    await expect(
      w.getByRole("region", { name: "Expected cash plan", exact: true }),
    ).toContainText("200.02");
    await authorize(
      w
        .getByRole("region", { name: "Forecast status action", exact: true })
        .locator("form"),
      "Cancel cash forecast",
    );
    await expect(
      w.getByRole("heading", { name: "Edit cash forecast", exact: true }),
    ).toHaveCount(0);
    await authorize(
      w
        .getByRole("region", { name: "Forecast status action", exact: true })
        .locator("form"),
      "Reopen cash forecast",
    );
    await expect(
      w.getByRole("heading", { name: "Edit cash forecast", exact: true }),
    ).toBeVisible();
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(before);
    const source = await w.request.get("/api/v1/finance/forecasts/" + id);
    expect((await source.json()).data.history).toHaveLength(4);
    expect(source.headers()["cache-control"]).toContain("no-store");
    await w.setViewportSize({ width: 390, height: 844 });
    expect(
      await w.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page: w })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const m = await manager.newPage();
    await login(m, "e2e.finance.commercial.manager@example.test");
    expect(
      (await m.request.get("/api/v1/finance/budgets/" + secondId)).status(),
    ).toBe(403);
    expect(
      (await m.request.get("/api/v1/finance/forecasts/" + id)).status(),
    ).toBe(403);
  } finally {
    await Promise.allSettled([writer.close(), manager.close()]);
    if (writerId)
      await f.sql.query(
        'DELETE FROM "FinanceGrant" WHERE "userId"=$1 AND "grantedById"=$2',
        [writerId, f.owner.id],
      );
    await f.close();
  }
});
