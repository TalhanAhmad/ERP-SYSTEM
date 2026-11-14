import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("explicit lot disposal UI posts exact basis, separate fees and a traceable reversal", async ({
  page,
  browser,
}) => {
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.inv.moves",
    ),
    p = "I24." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    writer = await browser.newContext();
  try {
    const control = await f.seedAccount(p + ".INV", {
        controlType: "INVESTMENT",
      }),
      recv = await f.seedAccount(p + ".RECV", {
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
      }),
      holding = await f.create("holdings", {
        name: p + " holding",
        partyId: party.id,
        investmentType: "Synthetic fund",
        unitMode: "UNIT",
        classification: "CURRENT",
        policyStatus: "REVIEWED",
        measurementMode: "COST",
        valuationTreatment: "PROFIT_LOSS",
        policy: "Reviewed synthetic cost and impairment policy",
        evidence: "Explicit synthetic policy evidence",
        investmentAccountId: control.id,
        gainAccountId: income.id,
        lossAccountId: expense.id,
        feeAccountId: expense.id,
        incomeAccountId: income.id,
        incomeControlAccountId: recv.id,
        impairmentAccountId: expense.id,
        reason: "Synthetic holding",
      }),
      acq = await f.create("movements", {
        kind: "INVESTMENT_ACQUISITION",
        holdingId: holding.id,
        fromCashId: bank.id,
        amount: "100.01",
        units: "3",
        reference: p,
        documentDate: period.start,
        postingDate: period.start,
        description: "Synthetic initial purchase",
        evidence: "Reviewed purchase",
        reason: "Synthetic acquisition",
      });
    await f.create("movements/" + acq.id + "/post", {
      expectedVersion: 1,
      reason: "Post initial synthetic purchase",
    });
    const lots = (
      await (
        await page.request.get(
          "/api/v1/finance/holdings/" + holding.id + "/lots",
        )
      ).json()
    ).data;
    const w = await writer.newPage();
    await login(w, "e2e.finance.inv.writer@example.test");
    await w.goto("/finance/investments/" + holding.id + "/movements/new");
    await w.getByLabel("Gross disposal proceeds (PKR)").fill("50.00");
    await w.getByLabel("Disposal fees (PKR)").fill("1.00");
    await w
      .getByLabel("Search settlement bank or cash", { exact: true })
      .fill(p);
    await w
      .getByLabel("Settlement bank or cash", { exact: true })
      .selectOption(bank.id);
    await w.getByRole("button", { name: "Add lot", exact: true }).click();
    await w.getByLabel("Search lot 1", { exact: true }).fill(p);
    await w.getByLabel("Lot 1", { exact: true }).selectOption(lots.items[0].id);
    await w.getByLabel("Units to dispose for lot 1").fill("1");
    await w.getByLabel("External reference").fill(p + " sale");
    await w.getByLabel("Document date", { exact: true }).fill(period.start);
    await w.getByLabel("Posting date", { exact: true }).fill(period.start);
    await w
      .getByLabel("Movement description")
      .fill("Synthetic partial lot sale");
    await w
      .getByLabel("Supporting evidence reference")
      .fill("Reviewed sale and bank evidence");
    await w
      .getByLabel("Reason", { exact: true })
      .fill("Record reviewed disposal");
    await w.getByLabel("Current password", { exact: true }).fill(f.password);
    await w
      .getByRole("button", { name: "Create investment movement", exact: true })
      .click();
    await expect(w).toHaveURL(/\/finance\/movements\/[0-9a-f-]{36}$/);
    await expect(
      w.getByRole("region", { name: "Reviewed lot basis" }),
    ).toContainText("33.34");
    const post = w.getByRole("region", { name: "Post movement", exact: true });
    await post.getByRole("checkbox").check();
    await post.getByLabel("Reason", { exact: true }).fill("Post reviewed sale");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post movement", exact: true })
      .click();
    await expect(
      w.getByText("INVESTMENT DISPOSAL · POSTED · version 2 · PKR"),
    ).toBeVisible();
    const id = w.url().split("/").pop(),
      detail = (
        await (
          await w.request.get("/api/v1/finance/holdings/" + holding.id)
        ).json()
      ).data;
    expect(detail).toMatchObject({
      originalCost: "66.67",
      carryingValue: "66.67",
      realizedResult: "16.66",
      fees: "1.00",
    });
    const reverse = w.getByRole("region", {
      name: "Reverse movement",
      exact: true,
    });
    await reverse.getByRole("checkbox").check();
    await reverse
      .getByLabel("Reason", { exact: true })
      .fill("Reverse synthetic lot sale");
    await reverse
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    const done = w.waitForResponse(
      (r) =>
        r.url().endsWith("/movements/" + id + "/reverse") &&
        r.request().method() === "POST",
    );
    await reverse
      .getByRole("button", { name: "Reverse movement", exact: true })
      .click();
    expect((await done).ok()).toBe(true);
    const restored = (
      await (
        await w.request.get("/api/v1/finance/holdings/" + holding.id)
      ).json()
    ).data;
    expect(restored).toMatchObject({
      originalCost: "100.01",
      carryingValue: "100.01",
      realizedResult: "0.00",
      fees: "0.00",
    });
  } finally {
    await writer.close();
    await f.close();
  }
});
