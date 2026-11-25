import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login } from "./helpers";

test("finance directory and searchable navigation work on mobile with keyboard access", async ({
  page,
}) => {
  await login(page, "e2e.finance@example.test");
  await page.goto("/finance");
  await expect(
    page.getByRole("heading", { name: "Finance overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cash forecasts", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  const nav = page.getByRole("navigation", {
    name: "Finance navigation",
    exact: true,
  });
  await expect(nav.locator("details")).toHaveJSProperty("open", false);
  expect(
    await page
      .getByRole("heading", { level: 1 })
      .evaluate((h) => h.getBoundingClientRect().top),
  ).toBeLessThan(700);
  await nav.locator("summary").focus();
  await page.keyboard.press("Enter");
  const search = nav.getByRole("searchbox", { name: "Find a finance page" });
  await expect(search).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await search.fill("no-such-finance-page");
  await expect(nav.getByRole("status")).toContainText("No finance pages match");
  await search.fill("loans");
  await expect(
    nav.getByRole("link", { name: "Loans", exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await nav.getByRole("link", { name: "Loans", exact: true }).click();
  await expect(page).toHaveURL(/\/finance\/loans$/);
  await expect(nav.locator("details")).toHaveJSProperty("open", false);
  await nav.locator("summary").click();
  await expect(nav.getByRole("searchbox")).toHaveValue("");
  await expect(
    nav.getByRole("link", { name: "Loans", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("switching financial statements keeps the chosen cutoff and clearly names the return month", async ({
  page,
}) => {
  await login(page, "e2e.finance@example.test");
  await page.goto("/finance/reports/profit-loss?from=2020-01-01&to=2020-01-31");
  await page
    .getByRole("link", { name: "Balance sheet at period end", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/finance\/reports\/balance-sheet\?asOf=2020-01-31$/,
  );
  await expect(page.getByLabel("Statement as-of date")).toHaveValue(
    "2020-01-31",
  );
  await page
    .getByRole("link", { name: "Profit and loss for this month", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/finance\/reports\/profit-loss\?from=2020-01-01&to=2020-01-31$/,
  );
  await expect(page.getByLabel("Posting start date")).toHaveValue("2020-01-01");
  await expect(page.getByLabel("Posting end date")).toHaveValue("2020-01-31");
  const exportLink = page.getByRole("link", {
    name: "Export this report to CSV / PDF",
    exact: true,
  });
  await expect(exportLink).toHaveAttribute(
    "href",
    /from=2020-01-01&to=2020-01-31/,
  );
});
