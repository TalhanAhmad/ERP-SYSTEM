import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("email confirmation guidance has no account information and keeps navigation internal", async ({
  page,
}) => {
  for (const [state, message] of [
    ["pending", "Confirm the change from both your current and new inboxes."],
    ["failed", "This confirmation could not be completed."],
    ["complete", "Your confirmation was accepted."],
  ]) {
    await page.goto(
      "/email-change?state=" + state + "&next=https://untrusted.example",
    );
    await expect(
      page.getByRole("heading", {
        name: "Login email confirmation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("paragraph")).toContainText(message);
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }),
    ).toHaveAttribute("href", "/login");
    await expect(
      page.getByRole("link", { name: "Account security", exact: true }),
    ).toHaveAttribute("href", "/security");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});
