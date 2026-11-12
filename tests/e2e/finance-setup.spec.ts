import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { login } from "./helpers";

const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");

test("owner configures accounts and periods; selected administrators have a read-only mobile view", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const base = String(test.info().project.use.baseURL);
  const password = "Synthetic-browser-test-only-9#";
  const owner = (
    await sql.query('SELECT id,username FROM "Person" WHERE username=$1', [
      "e2e.finance.setup",
    ])
  ).rows[0];
  const prefix = `B05.${crypto.randomUUID().slice(0, 7).toUpperCase()}`;
  const readerContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  const reader = await readerContext.newPage();
  const cleanup = async () => {
    const current = (await sql.query('SELECT "ownerId" FROM "FinanceSettings"'))
      .rows[0];
    if (current && current.ownerId !== owner.id)
      throw new Error("Refuse to clear unowned finance owner");
    if (current) await sql.query('TRUNCATE "FinanceSettings"');
    await sql.query('DELETE FROM "FinanceGrant" WHERE "userId"=$1', [owner.id]);
  };
  const authorize = async (
    form: ReturnType<typeof page.locator>,
    button: string,
  ) => {
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Reviewed synthetic browser setup");
    await form.getByLabel("Current password").fill(password);
    await form.getByRole("button", { name: button, exact: true }).click();
  };
  try {
    await cleanup();
    await login(page, owner.username + "@example.test");
    await mkdir(".local/finance", { recursive: true });
    const file = resolve(
      `.local/finance/browser-setup-${crypto.randomUUID()}.json`,
    );
    await writeFile(
      file,
      JSON.stringify({
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
        password,
        reason: "Explicit isolated setup owner",
      }),
      { mode: 0o600 },
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--conditions=react-server",
        "scripts/finance/setup-owner.ts",
      ],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          DATABASE_URL: url,
          DIRECT_URL: url,
          APP_URL: base,
          BETTER_AUTH_URL: base,
          AUTH_PROVIDER: "better-auth",
          FINANCE_ENABLED: "true",
          FINANCE_OWNER_ID: owner.id,
          FINANCE_OWNER_USERNAME: owner.username,
          FINANCE_OPERATOR_ACK: "BOOTSTRAP_EXPLICIT_OWNER",
          FINANCE_CREDENTIAL_FILE: file,
        },
      },
    );
    await page.goto("/finance/accounts/new");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.getByLabel("Account name").fill(prefix + " group");
    await page.getByLabel("Account code").fill(prefix + ".G");
    await page.getByLabel("Posting account", { exact: false }).uncheck();
    await authorize(page.locator("form"), "Create account");
    await expect(page).toHaveURL(/\/finance\/accounts\/[0-9a-f-]+$/);
    const groupId = page.url().split("/").at(-1)!;
    await page.goto("/finance/accounts/new");
    await page.getByLabel("Account name").fill(prefix + " cash");
    await page.getByLabel("Account code").fill(prefix + ".C");
    await page.getByLabel("Control register").selectOption("CASH");
    await page.getByLabel("Cash-equivalent account", { exact: false }).check();
    await page
      .getByLabel("Search parent group", { exact: true })
      .fill(prefix + ".G");
    await page
      .getByLabel("Parent group", { exact: true })
      .selectOption(groupId);
    await authorize(page.locator("form"), "Create account");
    await expect(page).toHaveURL(/\/finance\/accounts\/[0-9a-f-]+$/);
    const leafPath = new URL(page.url()).pathname;
    await page.getByLabel("Account name").fill(prefix + " renamed cash");
    await authorize(
      page.locator("form").filter({ has: page.getByLabel("Account name") }),
      "Save account",
    );
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "renamed cash",
    );
    await expect(page.getByLabel("Current password").first()).toHaveValue("");
    await expect(
      page.getByRole("region", { name: "Record history", exact: true }),
    ).toContainText("account update");

    // Retained fixtures are intentional: no deletion of configuration/audit history.
    const max = (
      await sql.query('SELECT max("endDate") AS last FROM "FinancePeriod"')
    ).rows[0].last;
    const start = new Date(
      Math.max(
        new Date(max ?? "6000-01-01").getTime(),
        new Date("6000-01-01").getTime(),
      ) +
        35 * 86400000,
    );
    const end = new Date(start.getTime() + 29 * 86400000);
    await page.goto("/finance/periods");
    const create = page.getByRole("region", {
      name: "Create accounting period",
      exact: true,
    });
    await create.getByLabel("Period name").fill(prefix + " period");
    await create
      .getByLabel("Start date (inclusive)")
      .fill(start.toISOString().slice(0, 10));
    await create
      .getByLabel("End date (inclusive)")
      .fill(end.toISOString().slice(0, 10));
    await authorize(create.locator("form"), "Create open period");
    await expect(page).toHaveURL(/\/finance\/periods\/[0-9a-f-]+$/);
    const periodPath = new URL(page.url()).pathname;
    await page.getByLabel("Period name").fill(prefix + " revised period");
    await authorize(
      page.locator("form").filter({ has: page.getByLabel("Period name") }),
      "Save period",
    );
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "revised period",
    );
    await authorize(
      page.locator("form").filter({
        has: page.getByRole("button", {
          name: "Void unused period",
          exact: true,
        }),
      }),
      "Void unused period",
    );
    await expect(
      page.getByRole("button", { name: "Void unused period", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Record history", exact: true }),
    ).toContainText("period void");

    await login(reader, "e2e.finance@example.test");
    await reader.goto(leafPath);
    await expect(reader.getByRole("heading", { level: 1 })).toContainText(
      "renamed cash",
    );
    await expect(
      reader.getByRole("button", { name: "Save account", exact: true }),
    ).toHaveCount(0);
    const denied = await reader.request.patch(
      "/api/v1/finance/accounts/" + leafPath.split("/").at(-1),
      {
        headers: {
          Origin: base,
          "X-Encova-CSRF": "1",
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: {},
      },
    );
    expect(denied.status()).toBe(403);
    await reader.goto(`/finance/accounts?q=${prefix}`);
    await expect(
      reader.getByRole("link", { name: "New account", exact: true }),
    ).toHaveCount(0);
    await expect(
      reader.getByText("2 matching accounts", { exact: false }),
    ).toBeVisible();
    const table = reader.getByRole("region", {
      name: "Account table",
      exact: true,
    });
    await table.focus();
    await expect(table).toBeFocused();
    await reader.keyboard.press("ArrowRight");
    await expect
      .poll(() => table.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    await reader.screenshot({
      path: test.info().outputPath("finance-accounts-mobile.png"),
      fullPage: true,
    });
    expect(
      (
        await new AxeBuilder({ page: reader })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await reader.goto(periodPath);
    await expect(reader.getByRole("heading", { level: 1 })).toContainText(
      "revised period",
    );
    await expect(reader.locator('input[type="password"]')).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page: reader })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await reader.goto("/finance/accounts?type=INVALID");
    await expect(
      reader.getByRole("alert").filter({ hasText: "Invalid filters" }),
    ).toBeVisible();
    expect(
      (
        await reader.request.get("/api/v1/finance/accounts?type=INVALID")
      ).status(),
    ).toBe(422);

    const staticContext = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    try {
      const staticPage = await staticContext.newPage();
      await staticPage.goto("/finance/accounts/new");
      const form = staticPage
        .locator("form")
        .filter({ has: staticPage.locator('input[name="password"]') });
      await expect(form).toHaveAttribute("method", "post");
      await expect(form.locator('input[name="password"]')).toBeDisabled();
    } finally {
      await staticContext.close();
    }
  } finally {
    await readerContext.close();
    await cleanup();
    await sql.end();
  }
});
