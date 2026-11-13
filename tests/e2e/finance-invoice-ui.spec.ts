import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
test("invoice editor recovers a lost create response, previews, posts and privately downloads", async ({
  page,
}) => {
  test.setTimeout(120000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.invoice.ui"),
    prefix = "B12." + crypto.randomUUID().slice(0, 7).toUpperCase();
  try {
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      revenue = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      period = await f.historicalPeriod(prefix + " period");
    const client = await f.create("parties", {
      name: prefix + " client",
      legalName: "Synthetic Café Client",
      kind: "CLIENT",
      address: "Original address",
      reason: "UI fixture client",
    });
    await page.goto("/finance/invoices/new");
    const form = page.locator("form");
    for (const [label, search, id] of [
      ["Invoice client", prefix, client.id],
      ["Receivables account", prefix + ".AR", ar.id],
    ]) {
      await form
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(search);
      await form.getByLabel(label, { exact: true }).selectOption(id);
    }
    await form.getByLabel("External reference").fill(prefix);
    for (const label of ["Invoice date", "Posting date", "Due date"])
      await form
        .getByLabel(label, { exact: true })
        .fill(label === "Due date" ? period.end : period.start);
    await form
      .getByLabel("Invoice description")
      .fill("Synthetic invoice UI service");
    await form
      .getByLabel("Supporting evidence reference")
      .fill("Synthetic evidence only");
    await form
      .getByRole("button", { name: "Add invoice line", exact: true })
      .click();
    await form.getByLabel("Line 1 description").fill("Earned café service");
    await form.getByLabel("Line 1 quantity", { exact: true }).fill("2");
    await form.getByLabel("Line 1 unit rate (PKR)").fill("100.005");
    await form.getByLabel("Line 1 discount (PKR)").fill("0.01");
    await form
      .getByLabel("Search revenue account for line 1")
      .fill(prefix + ".REV");
    await form
      .getByLabel("Revenue account for line 1", { exact: true })
      .selectOption(revenue.id);
    await expect(form.getByText(/Invoice total:/)).toContainText("200.00");
    const submit = async (target: typeof form, label: string) => {
      await target
        .getByLabel("Reason", { exact: true })
        .fill("Reviewed invoice UI evidence");
      await target.getByLabel("Current password").fill(f.password);
      await target.getByRole("button", { name: label, exact: true }).click();
    };
    await page.route("**/api/v1/finance/invoices", async (route) => {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Uncertain response: retry unchanged invoice." },
        }),
      });
      await page.unroute("**/api/v1/finance/invoices");
    });
    await submit(form, "Create invoice draft");
    await expect(form.getByRole("alert")).toContainText("Uncertain response");
    await submit(form, "Create invoice draft");
    await expect(page).toHaveURL(/\/finance\/invoices\/[0-9a-f-]+$/);
    const edit = page
      .getByRole("region", { name: "Edit invoice draft", exact: true })
      .locator("form");
    await edit
      .getByLabel("Invoice description")
      .fill("Reviewed service before posting");
    await submit(edit, "Save invoice draft");
    await expect(page.getByText("DRAFT · version 2 · PKR")).toBeVisible();
    const post = page
      .getByRole("region", { name: "Post invoice", exact: true })
      .locator("form");
    await post.getByRole("checkbox").check();
    await submit(post, "Post invoice");
    await expect(page.getByText("POSTED · version 3 · PKR")).toBeVisible();
    const download = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "Download private invoice PDF" })
      .click();
    expect((await download).suggestedFilename()).toMatch(/invoice-.*\.pdf/);
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceInvoice" WHERE reference=$1',
          [prefix],
        )
      ).rows[0].n,
    ).toBe(1);
    await page.screenshot({
      path: test.info().outputPath("invoice-mobile.png"),
      fullPage: true,
    });
  } finally {
    await f.close();
  }
});
