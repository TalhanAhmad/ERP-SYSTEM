import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
test("private transfer form posts both legs and excludes internal cash totals", async ({
  page,
}) => {
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.transfers",
    ),
    p = "T20." + crypto.randomUUID().slice(0, 6).toUpperCase();
  try {
    const a = await f.seedAccount(p + ".A", { controlType: "CASH" }),
      b = await f.seedAccount(p + ".B", { controlType: "CASH" }),
      period = await f.historicalPeriod(p);
    const from = await f.create("cash-accounts", {
        name: p + " source",
        kind: "BANK",
        currency: "PKR",
        glAccountId: a.id,
        maskedReference: null,
        reason: "Synthetic transfer",
      }),
      to = await f.create("cash-accounts", {
        name: p + " destination",
        kind: "BANK",
        currency: "PKR",
        glAccountId: b.id,
        maskedReference: null,
        reason: "Synthetic transfer",
      });
    await page.goto("/finance/transfers/new");
    for (const [label, id] of [
      ["Transfer from", from.id],
      ["Transfer to", to.id],
    ]) {
      await page
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(p);
      await page.getByLabel(label, { exact: true }).selectOption(id);
    }
    await page.getByLabel("Amount (PKR)", { exact: true }).fill("42.15");
    await page.getByLabel("Transfer reference").fill(p);
    await page.getByLabel("Document date", { exact: true }).fill(period.start);
    await page.getByLabel("Posting date", { exact: true }).fill(period.start);
    await page
      .getByLabel("Movement description")
      .fill("Synthetic bank movement");
    await page
      .getByLabel("Supporting evidence reference")
      .fill("Reviewed demo evidence");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Browser transfer fixture");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create transfer draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/movements\/[0-9a-f-]{36}$/);
    const post = page.getByRole("region", {
      name: "Post movement",
      exact: true,
    });
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Post reviewed fixture");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post movement", exact: true })
      .click();
    await expect(
      page.getByText("TRANSFER · POSTED · version 2 · PKR"),
    ).toBeVisible();
    const id = page.url().split("/").pop(),
      response = await page.request.get(
        "/api/v1/finance/cash-register?cashAccountId=" +
          from.id +
          "&includeInternal=NO",
      );
    expect(response.headers()["cache-control"]).toContain("no-store");
    const data = (await response.json()).data;
    expect(data.total).toBe(0);
    expect(data.summary.closing).toBe("-42.15");
    expect(data.summary.externalOut).toBe("0.00");
    const reverse = page.getByRole("region", {
      name: "Reverse movement",
      exact: true,
    });
    await reverse.getByRole("checkbox").check();
    await reverse
      .getByLabel("Reason", { exact: true })
      .fill("Reverse synthetic transfer");
    await reverse
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    const done = page.waitForResponse(
      (r) =>
        r.url().endsWith("/movements/" + id + "/reverse") &&
        r.request().method() === "POST",
    );
    await reverse
      .getByRole("button", { name: "Reverse movement", exact: true })
      .click();
    expect((await done).ok()).toBe(true);
    await page.goto("/finance/movements/" + id);
    await expect(
      page.getByText("TRANSFER · REVERSED · version 2 · PKR"),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});
