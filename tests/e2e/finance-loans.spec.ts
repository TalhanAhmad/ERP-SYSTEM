import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
test("loan agreement UI keeps advanced principal as an asset and posts a typed cash movement", async ({
  page,
}) => {
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.loans",
    ),
    p = "L22." + crypto.randomUUID().slice(0, 6).toUpperCase();
  try {
    const principal = await f.seedAccount(p + ".PRINCIPAL", {
        controlType: "LOAN_RECEIVABLE",
      }),
      interest = await f.seedAccount(p + ".INTEREST", {
        controlType: "INTEREST_RECEIVABLE",
      }),
      income = await f.seedAccount(p + ".INCOME", {
        type: "OTHER_INCOME",
        normalSide: "CREDIT",
        reportGroup: "OTHER_INCOME",
      }),
      cash = await f.seedAccount(p + ".CASH", { controlType: "CASH" }),
      period = await f.historicalPeriod(p),
      party = await f.create("parties", {
        name: p + " borrower",
        legalName: p + " borrower",
        kind: "OTHER",
        reason: "Synthetic borrower",
      }),
      bank = await f.create("cash-accounts", {
        name: p + " bank",
        kind: "BANK",
        glAccountId: cash.id,
        reason: "Synthetic bank",
      });
    await page.goto("/finance/loans/new");
    await page
      .getByRole("combobox", { name: "Loan direction", exact: true })
      .selectOption("ADVANCED");
    await page.getByLabel("Loan name").fill(p + " agreement");
    for (const [label, id] of [
      ["Lender or borrower", party.id],
      ["Principal control account", principal.id],
      ["Interest control account", interest.id],
      ["Interest income account", income.id],
    ]) {
      await page
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(p);
      await page.getByLabel(label, { exact: true }).selectOption(id);
    }
    await page.getByLabel("Agreement start").fill(period.start);
    await page.getByLabel("Maturity date", { exact: true }).fill(period.end);
    await page.getByLabel("Agreed principal limit (PKR)").fill("1000.00");
    await page.getByLabel("Annual rate for reference (optional)").fill("12.5");
    await page
      .getByLabel("Agreement and reviewed interest policy")
      .fill("Manual reviewed interest, no automatic amortization");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Browser agreement fixture");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create loan agreement", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/loans\/[0-9a-f-]{36}$/);
    const loanId = page.url().split("/").pop();
    await page
      .getByRole("link", { name: "Record loan movement", exact: true })
      .click();
    await page
      .getByLabel("Search paying bank or cash", { exact: true })
      .fill(p);
    await page
      .getByLabel("Paying bank or cash", { exact: true })
      .selectOption(bank.id);
    await page.getByLabel("Amount (PKR)", { exact: true }).fill("75.15");
    await page.getByLabel("External reference").fill(p);
    await page.getByLabel("Document date", { exact: true }).fill(period.start);
    await page.getByLabel("Posting date", { exact: true }).fill(period.start);
    await page
      .getByLabel("Movement description")
      .fill("Synthetic loan advanced");
    await page
      .getByLabel("Supporting evidence reference")
      .fill("Reviewed loan and bank evidence");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Record loan advanced");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create loan movement", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/movements\/[0-9a-f-]{36}$/);
    const post = page.getByRole("region", {
      name: "Post movement",
      exact: true,
    });
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Post reviewed loan principal");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post movement", exact: true })
      .click();
    await expect(
      page.getByText("LOAN DISBURSEMENT · POSTED · version 2 · PKR"),
    ).toBeVisible();
    const r = await page.request.get("/api/v1/finance/loans/" + loanId);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const d = (await r.json()).data;
    expect(d.principal).toBe("75.15");
    expect(d.interest).toBe("0.00");
    await page.goto("/finance/loans?q=" + p);
    await expect(
      page.getByRole("row").filter({ hasText: p + " agreement" }),
    ).toContainText("ADVANCED");
    await expect(
      page.getByRole("row").filter({ hasText: p + " agreement" }),
    ).toContainText("75.15");
  } finally {
    await f.close();
  }
});
