import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
import AxeBuilder from "@axe-core/playwright";
test("asset registration allocates a posted purchase without another journal and void releases unused basis", async ({
  page,
  browser,
}) => {
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.assets",
    ),
    p = "A25." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    member = await browser.newContext();
  try {
    const fixed = await f.seedAccount(p + ".ASSET", {
        controlType: "FIXED_ASSET",
      }),
      ap = await f.seedAccount(p + ".AP", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "PAYABLES",
      }),
      period = await f.historicalPeriod(p),
      party = await f.create("parties", {
        name: p + " supplier",
        legalName: p + " supplier",
        kind: "SUPPLIER",
        reason: "Synthetic equipment supplier",
      }),
      bill = await f.create("bills", {
        kind: "BILL",
        reference: p,
        partyId: party.id,
        payableAccountId: ap.id,
        billDate: period.start,
        postingDate: period.start,
        dueDate: period.end,
        description: "Synthetic equipment purchase",
        evidence: "Reviewed purchase evidence",
        lines: [
          {
            description: p + " laptop",
            quantity: "1",
            unitRate: "100.01",
            discountAmount: "0.00",
            treatment: "ASSET",
            costAccountId: fixed.id,
          },
        ],
        reason: "Synthetic fixed asset purchase",
      });
    await f.create("bills/" + bill.id + "/post", {
      expectedVersion: 1,
      reason: "Post equipment cost once",
    });
    const before = (
        await f.sql.query(
          'SELECT count(*)::int AS count FROM "FinanceJournalEntry"',
        )
      ).rows[0].count,
      source = (
        await (
          await page.request.get("/api/v1/finance/bills/" + bill.id)
        ).json()
      ).data.item.lines[0];
    await page.goto("/finance/assets/new");
    await page
      .getByLabel("Search posted asset purchase", { exact: true })
      .fill(p);
    await page
      .getByLabel("Posted asset purchase", { exact: true })
      .selectOption(source.id);
    await page.getByLabel("Allocated purchase cost (PKR)").fill("100.01");
    await page.getByLabel("Asset tag", { exact: true }).fill(p + "-LAPTOP");
    await page.getByLabel("Location", { exact: true }).fill("Synthetic office");
    await page
      .getByLabel("Asset description")
      .fill("Synthetic laptop linked to posted bill");
    await page.getByLabel("In-service date").fill(period.start);
    await page.getByLabel("Useful life (months)").fill("36");
    await page.getByLabel("Residual value (PKR)").fill("0.01");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Register already posted purchase");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Register purchased asset", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/assets\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop();
    await expect(
      page.getByRole("heading", { name: new RegExp(p + "-LAPTOP") }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Asset purchase and policy" }),
    ).toContainText("Awaiting company confirmation");
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS count FROM "FinanceJournalEntry"',
        )
      ).rows[0].count,
    ).toBe(before);
    const r = await page.request.get("/api/v1/finance/assets/" + id);
    expect(r.headers()["cache-control"]).toContain("no-store");
    expect((await r.json()).data.item).toMatchObject({
      cost: "100.01",
      accumulatedDepreciation: "0.00",
      convention: "PENDING",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    const m = await member.newPage();
    await login(m, "e2e.hr@example.test");
    expect((await m.request.get("/api/v1/finance/assets/" + id)).status()).toBe(
      403,
    );
    expect(
      (
        await m.request.get("/api/v1/finance/asset-options?kind=BILL_LINE")
      ).status(),
    ).toBe(403);
    const section = page.getByRole("region", {
      name: "Correct unused registration",
      exact: true,
    });
    await section.getByRole("checkbox").check();
    await section
      .getByLabel("Reason", { exact: true })
      .fill("Release unused registration for correction");
    await section
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await section
      .getByRole("button", { name: "Void unused registration", exact: true })
      .click();
    await expect(
      page.getByText("VOIDED · version 2", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS count FROM "FinanceJournalEntry"',
        )
      ).rows[0].count,
    ).toBe(before);
    const options = (
      await (
        await page.request.get(
          "/api/v1/finance/asset-options?kind=BILL_LINE&q=" + p,
        )
      ).json()
    ).data;
    expect(options.items[0].name).toContain("100.01");
  } finally {
    await member.close();
    await f.close();
  }
});
