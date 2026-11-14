import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
test("reviewed holding and acquisition UI create an original-cost lot and matching private journal", async ({
  page,
}) => {
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.investments",
    ),
    p = "I23." + crypto.randomUUID().slice(0, 6).toUpperCase();
  try {
    const control = await f.seedAccount(p + ".INV", {
        controlType: "INVESTMENT",
      }),
      receivable = await f.seedAccount(p + ".RECV", {
        controlType: "INVESTMENT_INCOME_RECEIVABLE",
      }),
      income = await f.seedAccount(p + ".INCOME", {
        type: "OTHER_INCOME",
        normalSide: "CREDIT",
        reportGroup: "OTHER_INCOME",
      }),
      expense = await f.seedAccount(p + ".EXPENSE", {
        type: "OTHER_EXPENSE",
        normalSide: "DEBIT",
        reportGroup: "OTHER_EXPENSES",
      }),
      cash = await f.seedAccount(p + ".CASH", { controlType: "CASH" }),
      period = await f.historicalPeriod(p),
      party = await f.create("parties", {
        name: p + " issuer",
        legalName: p + " issuer",
        kind: "OTHER",
        reason: "Synthetic issuer",
      }),
      bank = await f.create("cash-accounts", {
        name: p + " bank",
        kind: "BANK",
        glAccountId: cash.id,
        reason: "Synthetic bank",
      });
    await page.goto("/finance/investments/new");
    await page.getByLabel("Holding name", { exact: true }).fill(p + " holding");
    await page
      .getByLabel("Investment type", { exact: true })
      .fill("Synthetic fund");
    await page
      .getByRole("combobox", { name: "Policy review status", exact: true })
      .selectOption("REVIEWED");
    await page
      .getByLabel("Reviewed measurement and income policy")
      .fill("Explicit cost basis, manual impairment, private bookkeeping only");
    await page
      .getByLabel("Policy evidence reference")
      .fill("Synthetic reviewed policy");
    for (const [label, id] of [
      ["Issuer or counterparty", party.id],
      ["Investment control account", control.id],
      ["Disposal gain account", income.id],
      ["Disposal loss account", expense.id],
      ["Investment fee account", expense.id],
      ["Investment income account", income.id],
      ["Investment income receivable", receivable.id],
      ["Impairment expense account", expense.id],
    ]) {
      await page
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(p);
      await page.getByLabel(label, { exact: true }).selectOption(id);
    }
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Browser policy fixture");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create investment holding", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/investments\/[0-9a-f-]{36}$/);
    const holdingId = page.url().split("/").pop();
    await page
      .getByRole("link", { name: "Record acquisition", exact: true })
      .click();
    await page
      .getByLabel("Search paying bank or cash", { exact: true })
      .fill(p);
    await page
      .getByLabel("Paying bank or cash", { exact: true })
      .selectOption(bank.id);
    await page.getByLabel("Acquisition cost (PKR)").fill("100.01");
    await page.getByLabel("Units acquired").fill("1.234567");
    await page.getByLabel("External reference").fill(p);
    await page.getByLabel("Document date", { exact: true }).fill(period.start);
    await page.getByLabel("Posting date", { exact: true }).fill(period.start);
    await page
      .getByLabel("Movement description")
      .fill("Synthetic reviewed investment purchase");
    await page
      .getByLabel("Supporting evidence reference")
      .fill("Reviewed trade and bank evidence");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Browser acquisition fixture");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create acquisition draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/movements\/[0-9a-f-]{36}$/);
    const post = page.getByRole("region", {
      name: "Post movement",
      exact: true,
    });
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Post reviewed acquisition");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post movement", exact: true })
      .click();
    await expect(
      page.getByText("INVESTMENT ACQUISITION · POSTED · version 2 · PKR"),
    ).toBeVisible();
    const r = await page.request.get(
      "/api/v1/finance/holdings/" + holdingId + "/lots",
    );
    expect(r.headers()["cache-control"]).toContain("no-store");
    const d = (await r.json()).data;
    expect(d.total).toBe(1);
    expect(d.items[0]).toMatchObject({
      cost: "100.01",
      carryingValue: "100.01",
      remainingUnits: "1.234567",
    });
    await page.goto("/finance/investments/" + holdingId + "/lots");
    await expect(
      page.getByRole("region", { name: "Acquisition lot register" }),
    ).toContainText("1.234567");
  } finally {
    await f.close();
  }
});
