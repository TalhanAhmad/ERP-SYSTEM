import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("reviewed monthly asset drafts post separately, dispose with exact clearing and reverse with private mobile access", async ({
  page,
  browser,
}) => {
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.asset-lifecycle",
    ),
    p = "A26." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    other = await browser.newContext();
  try {
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const seed = async (
      fn: string,
      action: string,
      input: Record<string, unknown>,
    ) =>
      (
        await f.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4::jsonb,$5,$6) AS result`,
          [
            f.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].result;
    const fixed = await f.seedAccount(p + ".ASSET", {
        controlType: "FIXED_ASSET",
      }),
      ap = await f.seedAccount(p + ".AP", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "PAYABLES",
      }),
      expense = await f.seedAccount(p + ".EXP", {
        type: "OPERATING_EXPENSE",
        normalSide: "DEBIT",
        reportGroup: "OPERATING_EXPENSES",
      }),
      acc = await f.seedAccount(p + ".ACC", {
        controlType: "ACCUMULATED_DEPRECIATION",
        isContra: true,
        normalSide: "CREDIT",
      }),
      gain = await f.seedAccount(p + ".GAIN", {
        type: "OTHER_INCOME",
        normalSide: "CREDIT",
        reportGroup: "OTHER_INCOME",
      }),
      loss = await f.seedAccount(p + ".LOSS", {
        type: "OTHER_EXPENSE",
        normalSide: "DEBIT",
        reportGroup: "OTHER_EXPENSES",
      });
    const candidate = (
        await f.sql.query(
          `SELECT d::date::text AS start FROM generate_series(DATE '1600-01-01',DATE '1790-01-01',interval '1 year') d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]')&&daterange(d::date,(d+interval '1 year'-interval '1 day')::date,'[]')) ORDER BY d LIMIT 1`,
        )
      ).rows[0].start,
      year = candidate.slice(0, 4),
      date = year + "-01-31";
    await seed("encova_finance_setup_command", "PERIOD_CREATE", {
      name: p,
      startDate: candidate,
      endDate: year + "-12-31",
      reason: "Explicit isolated synthetic lifecycle year",
    });
    const party = await seed("encova_finance_master_command", "PARTY_CREATE", {
      name: p + " supplier",
      legalName: p + " supplier",
      kind: "SUPPLIER",
      contactEmail: null,
      phone: null,
      address: null,
      userId: null,
      reason: "Synthetic lifecycle vendor",
    });
    const bill = await seed("encova_finance_bill_command", "CREATE", {
      kind: "BILL",
      currency: "PKR",
      referenceReliable: true,
      duplicateAcknowledged: false,
      cashAccountId: null,
      projectId: null,
      reference: p,
      partyId: party.id,
      payableAccountId: ap.id,
      billDate: candidate,
      postingDate: candidate,
      dueDate: date,
      description: p + " equipment",
      evidence: "Synthetic purchase evidence",
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
      reason: "Synthetic equipment purchase",
    });
    await seed("encova_finance_bill_command", "POST", {
      id: bill.id,
      expectedVersion: 1,
      reason: "Recognize equipment cost",
    });
    const source = (
      await f.sql.query('SELECT id FROM "FinanceBillLine" WHERE "billId"=$1', [
        bill.id,
      ])
    ).rows[0].id;
    const asset = await seed("encova_finance_asset_command", "CREATE", {
      tag: p + "-LAPTOP",
      description: p + " equipment",
      location: "Test office",
      custodianId: null,
      billLineId: source,
      fundingMovementId: null,
      cost: "100.01",
      inServiceDate: candidate,
      usefulLifeMonths: 3,
      residualValue: "0.01",
      depreciationMethod: "STRAIGHT_LINE",
      convention: "FULL_MONTH_FROM_FIRST_MONTH",
      firstDepMonth: year + "-01",
      policyEvidence: "Reviewed full-month synthetic plan",
      reason: "Register posted cost",
    });
    await page.goto("/finance/assets/" + asset.id);
    await page
      .getByRole("link", {
        name: "Generate monthly depreciation draft",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Depreciation month", { exact: true })
      .fill(year + "-01");
    await page.getByLabel("Posting date", { exact: true }).fill(date);
    await page
      .getByLabel("Search depreciation or impairment expense", { exact: true })
      .fill(p + ".EXP");
    await page
      .getByLabel("Depreciation or impairment expense", { exact: true })
      .selectOption(expense.id);
    await page
      .getByLabel("Search accumulated depreciation control", { exact: true })
      .fill(p + ".ACC");
    await page
      .getByLabel("Accumulated depreciation control", { exact: true })
      .selectOption(acc.id);
    await page
      .getByLabel("Supporting evidence reference")
      .fill("Reviewed monthly charge evidence");
    await page
      .getByLabel("Policy or transaction approval evidence")
      .fill("Explicit monthly plan approval");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Generate only for review");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Generate monthly draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/asset-movements\/[a-f0-9-]{36}$/);
    const movement = page.url().split("/").pop()!;
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry" WHERE "assetMovementId"=$1',
          [movement],
        )
      ).rows[0].n,
    ).toBe(0);
    const post = page.getByRole("region", {
      name: "POST asset movement",
      exact: true,
    });
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Review and post monthly depreciation");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "POST asset movement", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Asset movement journal", exact: true }),
    ).toContainText("33.33");
    await page.goto("/finance/assets/" + asset.id);
    await expect(
      page.getByRole("region", { name: "Correct unused registration" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Useful life (months)")).toBeDisabled();
    await page
      .getByRole("link", { name: "Record asset movement", exact: true })
      .click();
    await page.getByLabel("Asset movement type").selectOption("DISPOSAL");
    await page.getByLabel("Posting date", { exact: true }).fill(date);
    await page
      .getByLabel("Description", { exact: true })
      .fill("Synthetic nil-proceeds disposal");
    await page
      .getByLabel("Search disposal gain account", { exact: true })
      .fill(p + ".GAIN");
    await page
      .getByLabel("Disposal gain account", { exact: true })
      .selectOption(gain.id);
    await page
      .getByLabel("Search disposal loss account", { exact: true })
      .fill(p + ".LOSS");
    await page
      .getByLabel("Disposal loss account", { exact: true })
      .selectOption(loss.id);
    await page
      .getByLabel("Supporting evidence reference")
      .fill("Reviewed nil-proceeds retirement");
    await page
      .getByLabel("Policy or transaction approval evidence")
      .fill("Explicit retirement authorization");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Create reviewed disposal");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page
      .getByRole("button", { name: "Create asset movement draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/asset-movements\/[a-f0-9-]{36}$/);
    const disposal = page.url().split("/").pop()!;
    const postDisposal = page.getByRole("region", {
      name: "POST asset movement",
      exact: true,
    });
    await postDisposal.getByRole("checkbox").check();
    await postDisposal
      .getByLabel("Reason", { exact: true })
      .fill("Post reviewed retirement");
    await postDisposal
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await postDisposal
      .getByRole("button", { name: "POST asset movement", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Asset movement journal", exact: true }),
    ).toContainText("66.68");
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
    const m = await other.newPage();
    await login(m, "e2e.hr@example.test");
    expect(
      (
        await m.request.get("/api/v1/finance/asset-movements/" + disposal)
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.get("/api/v1/finance/asset-movements/" + disposal)
      ).headers()["cache-control"],
    ).toContain("no-store");
    const reverse = page.getByRole("region", {
      name: "REVERSE asset movement",
      exact: true,
    });
    await reverse.getByRole("checkbox").check();
    await reverse
      .getByLabel("Reason", { exact: true })
      .fill("Correct synthetic disposal with opposite journal");
    await reverse
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await reverse
      .getByRole("button", { name: "REVERSE asset movement", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: /Reversal ASM-/ }),
    ).toBeVisible();
    await page.goto("/finance/assets/" + asset.id);
    await expect(
      page.getByRole("region", {
        name: "Asset purchase and policy",
        exact: true,
      }),
    ).toContainText("66.68");
  } finally {
    await other.close();
    await f.close();
  }
});
