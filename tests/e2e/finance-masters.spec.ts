import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test.use({ actionTimeout: 10000 });
test("owner manages parties and cash mappings; selected users read shared drawers without setup controls", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const base = String(test.info().project.use.baseURL),
    fixture = await financeFixture(page, base, "e2e.finance.masters"),
    prefix = "B10." + crypto.randomUUID().slice(0, 7).toUpperCase();
  const readerContext = await browser.newContext({
      viewport: { width: 360, height: 800 },
    }),
    reader = await readerContext.newPage();
  const authorize = async (
    form: ReturnType<typeof page.locator>,
    label: string,
  ) => {
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Reviewed synthetic master record");
    await form.getByLabel("Current password").fill(fixture.password);
    await form.getByRole("button", { name: label, exact: true }).click();
  };
  try {
    const gl = await fixture.seedAccount(prefix + ".BANK", {
      controlType: "CASH",
    });
    await page.goto("/finance/parties/new");
    const create = page
      .getByRole("region", { name: "Create party", exact: true })
      .locator("form");
    await create.getByLabel("Display name").fill(prefix + " client");
    await create.getByLabel("Legal name").fill("Synthetic Client Legal Co");
    await create.getByLabel("Contact email").fill("synthetic@example.test");
    await create.getByLabel("Phone").fill("+92 000 0000000");
    await create.getByLabel("Address").fill("Synthetic address only");
    await page.route("**/api/v1/finance/parties", async (route) => {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            message:
              "Temporary response failure; retry with your current password.",
          },
        }),
      });
      await page.unroute("**/api/v1/finance/parties");
    });
    await authorize(create, "Create party");
    await expect(create.getByRole("alert")).toContainText(
      "Temporary response failure",
    );
    await authorize(create, "Create party");
    await expect(page).toHaveURL(/\/finance\/parties\/[0-9a-f-]+$/);
    const partyPath = new URL(page.url()).pathname;
    const edit = page
      .getByRole("region", { name: "Edit party", exact: true })
      .locator("form");
    await edit.getByLabel("Legal name").fill("Corrected Synthetic Client Co");
    await authorize(edit, "Save party");
    await expect(edit.getByLabel("Current password")).toHaveValue("");
    await expect(
      page.getByRole("region", { name: "Record history", exact: true }),
    ).toContainText("party update");
    const state = page
      .getByRole("region", { name: "Archive or reactivate", exact: true })
      .locator("form");
    await authorize(state, "Archive party");
    await expect(
      state.getByRole("button", { name: "Reactivate party", exact: true }),
    ).toBeVisible();
    await authorize(state, "Reactivate party");
    await expect(
      state.getByRole("button", { name: "Archive party", exact: true }),
    ).toBeVisible();
    await page.goto("/finance/cash-accounts/new");
    const cash = page
      .getByRole("region", { name: "Create cash account", exact: true })
      .locator("form");
    await cash.getByLabel("Cash account name").fill(prefix + " operating bank");
    await cash
      .getByLabel("Search cash gl account", { exact: true })
      .fill(prefix + ".BANK");
    await cash
      .getByLabel("Cash GL account", { exact: true })
      .selectOption(gl.id);
    await cash.getByLabel("Last four digits").fill("4668");
    await authorize(cash, "Create cash account");
    await expect(page).toHaveURL(/\/finance\/cash-accounts\/[0-9a-f-]+$/);
    const cashPath = new URL(page.url()).pathname;
    expect(
      (
        await fixture.sql.query(
          'SELECT count(*)::int AS count FROM "FinanceParty" WHERE name=$1',
          [prefix + " client"],
        )
      ).rows[0].count,
    ).toBe(1);
    await login(reader, "e2e.finance@example.test");
    await reader.goto(partyPath);
    await expect(
      reader.getByText("Corrected Synthetic Client Co", { exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole("button", { name: "Save party", exact: true }),
    ).toHaveCount(0);
    await expect(reader.locator('input[type="password"]')).toHaveCount(0);
    await reader.goto("/finance/parties?q=" + prefix);
    await expect(
      reader.getByRole("link", { name: "New party", exact: true }),
    ).toHaveCount(0);
    await reader
      .getByRole("link", { name: prefix + " client", exact: true })
      .click();
    const dialog = reader.getByRole("dialog");
    await expect(
      dialog.getByText("Corrected Synthetic Client Co", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page: reader })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await reader.keyboard.press("Escape");
    await reader.goto(cashPath);
    await expect(
      reader.getByText("PKR · •••• 4668", { exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole("button", { name: "Save cash account", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page: reader })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const denied = await reader.request.post("/api/v1/finance/parties", {
      headers: {
        Origin: base,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {},
    });
    expect(denied.status()).toBe(403);
    await reader.goto("/finance/cash-accounts?active=ALL&q=" + prefix);
    await expect(
      reader.getByRole("link", {
        name: prefix + " operating bank",
        exact: true,
      }),
    ).toBeVisible();
    await reader.screenshot({
      path: test.info().outputPath("cash-accounts-mobile.png"),
      fullPage: true,
    });
    expect(
      await reader.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    try {
      await fixture.close();
    } finally {
      await readerContext.close();
    }
  }
});
