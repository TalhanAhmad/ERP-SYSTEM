import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
test("founder funding form keeps capital in equity and exposes a separate contributor register", async ({
  page,
}) => {
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.funding",
    ),
    p = "F21." + crypto.randomUUID().slice(0, 6).toUpperCase();
  try {
    const capital = await f.seedAccount(p + ".CAP", {
        type: "EQUITY",
        normalSide: "CREDIT",
        reportGroup: "EQUITY",
        controlType: "CAPITAL",
      }),
      cash = await f.seedAccount(p + ".BANK", { controlType: "CASH" }),
      period = await f.historicalPeriod(p),
      party = await f.create("parties", {
        name: p + " contributor",
        legalName: p + " contributor",
        kind: "OTHER",
        reason: "Synthetic contributor",
      }),
      bank = await f.create("cash-accounts", {
        name: p + " bank",
        kind: "BANK",
        glAccountId: cash.id,
        reason: "Synthetic company bank",
      });
    await page.goto("/finance/funding/new");
    await expect(
      page.getByRole("heading", { name: "New funding draft" }),
    ).toBeVisible();
    for (const [label, id] of [
      ["Contributor", party.id],
      ["Funding control account", capital.id],
      ["Receiving bank or cash", bank.id],
    ]) {
      await page
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(p);
      await page.getByLabel(label, { exact: true }).selectOption(id);
    }
    await page.getByLabel("Amount (PKR)", { exact: true }).fill("150.25");
    await page.getByLabel("External reference").fill(p);
    await page.getByLabel("Document date", { exact: true }).fill(period.start);
    await page.getByLabel("Posting date", { exact: true }).fill(period.start);
    await page
      .getByLabel("Funding description")
      .fill("Synthetic reviewed founder capital");
    await page
      .getByLabel("Supporting evidence reference")
      .fill("Approved capital evidence");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Browser funding fixture");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create funding draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/movements\/[0-9a-f-]{36}$/);
    const post = page.getByRole("region", {
      name: "Post movement",
      exact: true,
    });
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Post reviewed capital");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post movement", exact: true })
      .click();
    await expect(
      page.getByText("CAPITAL CONTRIBUTION · POSTED · version 2 · PKR"),
    ).toBeVisible();
    const id = page.url().split("/").pop(),
      r = await page.request.get("/api/v1/finance/movements/" + id);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const d = (await r.json()).data;
    expect(
      d.item.entry.lines.find(
        (l: { accountId: string }) => l.accountId === capital.id,
      ).credit,
    ).toBe("150.25");
    await page.goto("/finance/funding?contributor=" + p + "&q=" + p);
    await expect(
      page.getByRole("link", { name: d.item.number, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Posted contributor balances" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: p + " contributor" }),
    ).toContainText("150.25");
  } finally {
    await f.close();
  }
});
