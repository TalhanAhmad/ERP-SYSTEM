import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("bill UI posts a private reviewed cost once and denies employee access", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.bills"),
    prefix = "B16." + crypto.randomUUID().slice(0, 7).toUpperCase();
  const member = await browser.newContext();
  try {
    const ap = await f.seedAccount(prefix + ".AP", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "PAYABLES",
      }),
      cost = await f.seedAccount(prefix + ".COST", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      }),
      period = await f.historicalPeriod(prefix);
    const party = await f.create("parties", {
      name: prefix + " supplier",
      legalName: prefix + " Supplier Legal",
      kind: "SUPPLIER",
      reason: "Synthetic supplier only",
    });
    await page.goto("/finance/bills/new");
    await expect(
      page.getByRole("heading", { name: "New bill draft" }),
    ).toBeVisible();
    await page
      .getByLabel("Search supplier or private employee", { exact: true })
      .fill(prefix);
    await page
      .getByLabel("Supplier or private employee", { exact: true })
      .selectOption(party.id);
    await page
      .getByLabel("Search payables account", { exact: true })
      .fill(prefix);
    await page
      .getByLabel("Payables account", { exact: true })
      .selectOption(ap.id);
    await page.getByLabel("External reference").fill(prefix);
    await page.getByLabel("Bill date", { exact: true }).fill(period.start);
    await page.getByLabel("Posting date", { exact: true }).fill(period.start);
    await page.getByLabel("Due date", { exact: true }).fill(period.end);
    await page.getByLabel("Bill description").fill("Reviewed synthetic bill");
    await page
      .getByLabel("Supporting evidence reference")
      .fill("Browser purchase fixture");
    await page.getByRole("button", { name: "Add bill line" }).click();
    await page.getByLabel("Line 1 description").fill("Demo cost");
    await page.getByLabel("Line 1 unit rate (PKR)").fill("120.05");
    await page
      .getByLabel("Cost category for line 1", { exact: true })
      .selectOption(cost.id);
    await page.getByLabel("Reason").fill("Reviewed synthetic purchase");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create bill draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/bills\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /BIL-/ })).toBeVisible();
    const section = page.getByRole("region", {
      name: "Post bill",
      exact: true,
    });
    // Semantic section has no region role without label? aria-label makes it a named region.
    await section.getByRole("checkbox").check();
    await section.getByLabel("Reason").fill("Review and post cost");
    await section
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await section
      .getByRole("button", { name: "Post bill", exact: true })
      .click();
    await expect(page.getByText("POSTED · version 2 · PKR")).toBeVisible();
    await expect(page.getByText("Outstanding payable:")).toBeVisible();
    const id = page.url().split("/").pop(),
      r = await page.request.get("/api/v1/finance/bills/" + id);
    expect(r.headers()["cache-control"]).toContain("no-store");
    expect((await r.json()).data.payableBalance).toBe("120.05");
    const m = await member.newPage();
    await login(m, "e2e.member@example.test");
    expect((await m.request.get("/api/v1/finance/bills/" + id)).status()).toBe(
      403,
    );
  } finally {
    await member.close();
    await f.close();
  }
});
