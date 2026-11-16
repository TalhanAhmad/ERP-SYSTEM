import { test, expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("reviewed exact cost splits recover errors, post once, retain reversal history and keep project results private", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.cost",
    ),
    prefix = "CA28." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    other = await browser.newContext();
  const authorize = async (form: Locator, label: string) => {
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Explicit reviewed cost allocation");
    await form.getByLabel("Current password", { exact: true }).fill(f.password);
    await form.getByRole("button", { name: label, exact: true }).click();
  };
  try {
    const session = (
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
    const period = await f.historicalPeriod(prefix),
      expense = await f.seedAccount(prefix + ".COST", {
        type: "DIRECT_COST",
        normalSide: "DEBIT",
        reportGroup: "DIRECT_COSTS",
      }),
      offset = await f.seedAccount(prefix + ".ACCRUAL", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
      });
    const lead = (
      await f.sql.query('SELECT id FROM "Person" WHERE username=$1', [
        "e2e.finance.commercial.manager",
      ])
    ).rows[0];
    const projects = [
      { id: crypto.randomUUID(), name: prefix + " Alpha" },
      { id: crypto.randomUUID(), name: prefix + " Beta" },
    ];
    for (const p of projects)
      await f.sql.query(
        'INSERT INTO "Project"(id,name,description,"managerId","updatedAt") VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',
        [p.id, p.name, "Ordinary project", lead.id],
      );
    const original = await seed("encova_finance_ledger_command", "CREATE", {
      reference: prefix,
      postingDate: period.start,
      description: prefix + " source",
      evidence: "Reviewed incurred cost",
      currency: "PKR",
      lines: [
        {
          accountId: expense.id,
          description: prefix + " expense",
          debit: "0.03",
          credit: "0.00",
          projectId: null,
        },
        {
          accountId: offset.id,
          description: "Accrued cost",
          debit: "0.00",
          credit: "0.03",
          projectId: null,
        },
      ],
      reason: "Recognize real test cost",
    });
    await seed("encova_finance_ledger_command", "POST", {
      id: original.id,
      expectedVersion: 1,
      reason: "Post incurred source",
    });
    const line = (
      await f.sql.query(
        'SELECT l.id FROM "FinanceJournalLine" l JOIN "FinanceJournalEntry" e ON e.id=l."journalId" WHERE e."sourceId"=$1 AND l."accountId"=$2',
        [original.id, expense.id],
      )
    ).rows[0];
    const before = (
      await f.sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"')
    ).rows[0].n;
    await page.goto("/finance/cost-allocations/new");
    await page
      .getByLabel("Search posted expense source", { exact: true })
      .fill(prefix);
    await expect(
      page
        .getByLabel("Posted expense source", { exact: true })
        .getByRole("option")
        .filter({ hasText: prefix }),
    ).toHaveCount(1);
    await page
      .getByLabel("Posted expense source", { exact: true })
      .selectOption(line.id);
    await expect(
      page.getByRole("button", {
        name: "Create cost allocation draft",
        exact: true,
      }),
    ).toBeEnabled();
    for (const [index, p] of projects.entries()) {
      if (index)
        await page
          .getByRole("button", { name: "Add split", exact: true })
          .click();
      const label = "Project " + (index + 1) + " (empty means shared company)";
      await page
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(p.name);
      await expect(
        page
          .getByLabel(label, { exact: true })
          .getByRole("option")
          .filter({ hasText: p.name }),
      ).toHaveCount(1);
      await page.getByLabel(label, { exact: true }).selectOption(p.id);
      await page
        .getByLabel("Split " + (index + 1) + " percentage", { exact: true })
        .fill("50");
    }
    await page
      .getByRole("button", {
        name: "Calculate exact amounts from percentages",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Split 1 amount (PKR)", { exact: true }),
    ).toHaveValue("0.02");
    await expect(
      page.getByLabel("Split 2 amount (PKR)", { exact: true }),
    ).toHaveValue("0.01");
    await page.getByLabel("Posting date", { exact: true }).fill(period.start);
    await page
      .getByLabel("Description", { exact: true })
      .fill(prefix + " allocation");
    await page
      .getByLabel("Evidence reference", { exact: true })
      .fill("Approved exact project split");
    await page.getByLabel("Split 2 amount (PKR)", { exact: true }).fill("0.02");
    await authorize(page.locator("form"), "Create cost allocation draft");
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "Exact project/shared splits",
    );
    await expect(
      page.getByLabel("Current password", { exact: true }),
    ).toHaveValue("");
    await page.getByLabel("Split 2 amount (PKR)", { exact: true }).fill("0.01");
    await authorize(page.locator("form"), "Create cost allocation draft");
    await expect(page.getByRole("heading", { name: /^CAL-/ })).toBeVisible();
    const id = page.url().split("/").pop();
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(before);
    await authorize(
      page
        .getByRole("region", { name: "POST cost allocation", exact: true })
        .locator("form"),
      "Post cost allocation",
    );
    await expect(
      page.getByRole("heading", {
        name: "Posted allocation journal",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry" WHERE "costAllocationId"=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.goto(
      "/finance/project-results/" +
        projects[0].id +
        "?from=" +
        period.start +
        "&to=" +
        period.end,
    );
    await expect(
      page.getByRole("region", { name: "Project financial result" }),
    ).toContainText("0.02");
    const r = await page.request.get(
      "/api/v1/finance/project-results/" + projects[0].id,
    );
    expect(r.headers()["cache-control"]).toContain("no-store");
    await page.goto("/finance/cost-allocations/" + id);
    const reversal = page.getByRole("region", {
      name: "REVERSE cost allocation",
      exact: true,
    });
    await reversal
      .getByLabel("Reversal posting date", { exact: true })
      .fill(period.end);
    await authorize(reversal.locator("form"), "Reverse cost allocation");
    await expect(
      page.getByRole("link", { name: /^Reversal CAL-/ }),
    ).toBeVisible();
    const m = await other.newPage();
    await login(m, "e2e.finance.commercial.manager@example.test");
    expect(
      (
        await m.request.get("/api/v1/finance/project-results/" + projects[0].id)
      ).status(),
    ).toBe(403);
    expect(
      (await m.request.get("/api/v1/finance/cost-allocations/" + id)).status(),
    ).toBe(403);
  } finally {
    await other.close();
    await f.close();
  }
});
