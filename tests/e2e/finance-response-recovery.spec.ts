import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { closingDatabase } from "./closing-database";
import { financeFixture } from "./finance-fixture";
test("lost committed response retries the original key once without duplicate schedule or journal", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const isolated = await closingDatabase(browser),
    page = await isolated.context.newPage();
  let f: Awaited<ReturnType<typeof financeFixture>> | undefined;
  try {
    f = await financeFixture(page, isolated.base, "e2e.finance.closing", {
      url: isolated.url,
    });
    const prefix = "RETRY." + crypto.randomUUID().slice(0, 6).toUpperCase();
    const ap = await f.seedAccount(prefix + ".AP", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "PAYABLES",
      }),
      expense = await f.seedAccount(prefix + ".EXP", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      }),
      period = await f.historicalPeriod("Retry source period");
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const command = async (fn: string, action: string, input: unknown) =>
      (
        await f!.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS data`,
          [
            f!.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].data;
    const party = async (kind: string) =>
        command("encova_finance_master_command", "PARTY_CREATE", {
          name: prefix + kind,
          legalName: "Synthetic automation party",
          kind,
          contactEmail: null,
          phone: null,
          address: null,
          userId: null,
          reason: "Reviewed synthetic supplier/client",
        }),
      supplier = await party("SUPPLIER");
    await page.goto("/finance/automation");
    const create = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Create recurring draft schedule",
        exact: true,
      }),
    });
    await create
      .getByLabel("Schedule name", { exact: true })
      .fill("Reviewed recurring rent");
    await create
      .getByLabel("First month", { exact: true })
      .fill(period.start.slice(0, 7));
    await create
      .getByLabel("Last month (optional)", { exact: true })
      .fill(period.start.slice(0, 7));
    await create
      .getByLabel("Description", { exact: true })
      .fill("Reviewed monthly rent obligation");
    await create
      .getByLabel("Reviewed policy and source evidence")
      .fill("Owner reviewed fixed supplier obligation without assumed tax");
    for (const [label, id] of [
      ["Supplier", supplier.id],
      ["Payable account", ap.id],
      ["Expense account", expense.id],
    ]) {
      const select = create.getByLabel(label, { exact: true });
      await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
      await select.selectOption(id);
    }
    await create.getByLabel("Monthly amount (PKR)").fill("10.01");
    await create
      .getByLabel("Reason", { exact: true })
      .fill("Configure reviewed monthly draft only");
    await create
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    const keys: (string | null)[] = [];
    let lost = false;
    await page.route("**/api/v1/finance/automation", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"] ?? null);
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    });
    await create
      .getByRole("button", {
        name: "Create recurring draft schedule",
        exact: true,
      })
      .click();
    await expect(create.getByRole("alert")).toBeVisible();
    await expect(
      create.getByLabel("Current password", { exact: true }),
    ).toHaveValue("");
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceRecurringSchedule"',
        )
      ).rows[0].n,
    ).toBe(1);
    await create
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await create
      .getByRole("button", {
        name: "Create recurring draft schedule",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/finance\/automation\/[0-9a-f-]{36}$/);

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceRecurringSchedule"',
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(0);
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
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
  } finally {
    try {
      await f?.close();
    } finally {
      await isolated.close();
    }
  }
});
