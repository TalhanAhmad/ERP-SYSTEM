import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required.");

test("anonymous finance navigation uses the existing login and API session boundary", async ({
  page,
}) => {
  const result = await page.request.get("/api/v1/finance/status");
  expect(result.status()).toBe(401);
  expect(result.headers()["cache-control"]).toContain("no-store");
  await page.goto("/finance");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Sign in to workspace" }),
  ).toBeVisible();
});

test("an unselected Super Admin cannot see or open finance", async ({
  page,
}) => {
  await login(page, "e2e.admin@example.test");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Finance", exact: true }),
  ).toHaveCount(0);
  const api = await page.request.get("/api/v1/finance/status");
  expect(api.status()).toBe(403);
  expect(api.headers()["cache-control"]).toContain("no-store");
  const response = await page.goto("/finance");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(
    page.getByRole("heading", { name: "Page not found." }),
  ).toBeVisible();
});

test("a selected admin sees accessible setup and loses access after revocation", async ({
  page,
}) => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const person = (
    await sql.query('SELECT id FROM "Person" WHERE username=$1', [
      "e2e.finance",
    ])
  ).rows[0];
  const grant = (
    await sql.query(
      'SELECT id FROM "FinanceGrant" WHERE "userId"=$1 AND "revokedAt" IS NULL',
      [person.id],
    )
  ).rows[0];
  try {
    await login(page, "e2e.finance@example.test");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Finance", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Finance setup", exact: true }),
    ).toBeVisible();
    expect((await page.request.get("/api/v1/finance/status")).status()).toBe(
      200,
    );
    await page.setViewportSize({ width: 360, height: 800 });
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await sql.query("BEGIN");
    await sql.query('SELECT id FROM "Person" WHERE id=$1 FOR UPDATE', [
      person.id,
    ]);
    await sql.query("SELECT pg_advisory_xact_lock(629813,hashtext($1))", [
      person.id,
    ]);
    await sql.query(
      'UPDATE "FinanceGrant" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedById"=$1 WHERE id=$2',
      [person.id, grant.id],
    );
    await sql.query("COMMIT");
    const denied = await page.request.get("/api/v1/finance/status");
    expect(denied.status()).toBe(403);
    expect(denied.headers()["cache-control"]).toContain("no-store");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Page not found." }),
    ).toBeVisible();
    await page.goto("/dashboard");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Finance", exact: true }),
    ).toHaveCount(0);
  } finally {
    await sql.query("ROLLBACK");
    await sql.query(
      'UPDATE "FinanceGrant" SET "revokedAt"=NULL,"revokedById"=NULL WHERE id=$1',
      [grant.id],
    );
    await sql.end();
  }
});
