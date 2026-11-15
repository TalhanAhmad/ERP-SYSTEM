import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("cash flow reviews actual net cash with fresh authentication, retains replacement history and stays private on mobile", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.cash.flow",
    ),
    prefix = "CF35." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    lower = await browser.newContext();
  try {
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const command = async (fn: string, action: string, input: unknown) =>
      (
        await f.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS d`,
          [
            f.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].d;
    const gl = await f.seedAccount(prefix + ".BANK", { controlType: "CASH" }),
      advance = await f.seedAccount(prefix + ".ADV", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "CLIENT_ADVANCE",
      }),
      fee = await f.seedAccount(prefix + ".FEE", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      });
    const bank = await command("encova_finance_master_command", "CASH_CREATE", {
        name: prefix + " bank",
        kind: "BANK",
        glAccountId: gl.id,
        currency: "PKR",
        maskedReference: "1234",
        reason: "Reviewed synthetic bank",
      }),
      party = await command("encova_finance_master_command", "PARTY_CREATE", {
        name: prefix + " client",
        legalName: "Synthetic Legal Co",
        kind: "CLIENT",
        contactEmail: "synthetic@example.test",
        phone: null,
        address: null,
        userId: null,
        reason: "Reviewed synthetic source party",
      }),
      p = await f.historicalPeriod(prefix + " source dates");
    const receipt = await f.create("receipts", {
      reference: prefix + " net cash source",
      partyId: party.id,
      cashAccountId: bank.id,
      advanceAccountId: advance.id,
      feeAccountId: fee.id,
      documentDate: p.start,
      postingDate: p.start,
      description: "Actual 98 cash plus separate 2 bank fee",
      evidence: "Reviewed synthetic source",
      cashAmount: "98.00",
      feeAmount: "2.00",
      allocations: [],
      reason: "Actual reviewed receipt",
    });
    await f.create("receipts/" + receipt.id + "/post", {
      expectedVersion: receipt.version,
      reason: "Post actual cash source",
    });
    const entry = (
        await f.sql.query(
          'SELECT id FROM "FinanceJournalEntry" WHERE "customerDocumentId"=$1',
          [receipt.id],
        )
      ).rows[0],
      url =
        "/finance/reports/cash-flow?" +
        new URLSearchParams({ from: p.start, to: p.end });
    await page.goto(url);
    await expect(
      page.getByRole("heading", {
        name: "Cash classification review required",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Review cash split", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp("/cash-flow/" + entry.id));
    await page
      .getByLabel(prefix + ".BANK operating", { exact: true })
      .fill("98");
    await page
      .getByLabel("Classification evidence", { exact: true })
      .fill("Actual receipt cash purpose reviewed; separate fee excluded");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Explicit cash component confirmation");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Confirm cash split", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Replace reviewed cash split",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "confirmed · version 2", exact: true }),
    ).toBeVisible();
    await page.goto(url);
    await expect(
      page.getByRole("heading", {
        name: "Cash classifications tie to posted cash",
        exact: true,
      }),
    ).toBeVisible();
    const categories = page.getByRole("region", {
      name: "Cash flow categories",
      exact: true,
    });
    await expect(
      categories.getByRole("row").filter({ hasText: "operating" }),
    ).toContainText("98.00");
    await expect(categories).not.toContainText("100.00");
    await page
      .getByRole("link", { name: "View reviewed split", exact: true })
      .click();
    await page
      .getByLabel(prefix + ".BANK operating", { exact: true })
      .fill("60.00");
    await page
      .getByLabel(prefix + ".BANK investing", { exact: true })
      .fill("38.00");
    await page
      .getByLabel("Classification evidence", { exact: true })
      .fill("Synthetic replacement to verify mixed component review history");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Explicit revised purpose review");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Replace reviewed cash split", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "superseded · version 3",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    const report = await page.request.get(
      "/api/v1/finance/reports/cash-flow?" +
        new URLSearchParams({ from: p.start, to: p.end }),
    );
    expect(report.headers()["cache-control"]).toContain("no-store");
    expect((await report.json()).data).toMatchObject({
      externalNet: "98.00",
      difference: "0.00",
      classificationReady: true,
    });
    const lp = await lower.newPage();
    await login(lp, "e2e.member@example.test");
    for (const path of [
      "/api/v1/finance/reports/cash-flow?from=" + p.start + "&to=" + p.end,
      "/api/v1/finance/cash-flow/" + entry.id,
    ]) {
      const r = await lp.request.get(path);
      expect(r.status()).toBe(403);
      expect(await r.text()).not.toContain(prefix);
    }
    await lp.goto("/finance/cash-flow/" + entry.id);
    await expect(
      lp.getByRole("heading", {
        name: "Review cash classification",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await lower.close();
    await f.close();
  }
});
