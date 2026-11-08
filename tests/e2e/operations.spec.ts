import { test, expect } from "@playwright/test";
import { login } from "./helpers";
test("super admin queues and runs a monitored check while members are denied operations", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, "e2e.admin@example.test");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Operations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  const reason = `Browser attendance check ${Date.now()}`;
  await page.getByLabel("Reason for attendance check").fill(reason);
  await page
    .getByRole("button", { name: "Queue attendance check", exact: true })
    .click();
  const job = page
    .getByRole("article")
    .filter({ has: page.getByText(reason, { exact: true }) });
  await expect(job).toBeVisible();
  await job
    .getByLabel("Reason for this attempt")
    .fill("Synthetic browser reconciliation");
  await job
    .getByRole("button", { name: "Run next batch", exact: true })
    .click();
  await expect(job.locator(".badge")).toHaveText("succeeded");
  await job.getByText("Recent attempts", { exact: true }).click();
  await expect(
    job.getByText("Synthetic browser reconciliation", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  const context = await browser.newContext();
  const member = await context.newPage();
  try {
    await login(member, "e2e.member@example.test");
    expect((await member.request.get("/api/v1/operations")).status()).toBe(403);
    await member.goto("/operations");
    await expect(
      member.getByRole("heading", { name: "Page not found." }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
