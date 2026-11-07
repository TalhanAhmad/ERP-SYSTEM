import { expect, type Page } from "@playwright/test";
export async function login(page: Page, email: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  // Better Auth limits repeated logins from one IP. Separate browser accounts still
  // share loopback, so retry the public form until its short rate-limit window clears.
  await expect(async () => {
    await page.getByLabel("Work email").fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Synthetic-browser-test-only-9#");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 1500 });
  }).toPass({ timeout: 25000, intervals: [1000, 3000, 5000] });
}
