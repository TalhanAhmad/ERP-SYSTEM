import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("roll-forwards preserve dated project results and exact units, resolve credit/opposite sources and protect mobile access", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.rollforwards",
    ),
    prefix = "RF37." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    lower = await browser.newContext();
  try {
    // Authenticated operator-only fixture calls still use the actual checked posting commands.
    const command = async (fn: string, action: string, input: unknown) => {
      const session = (
        await f.sql.query(
          'SELECT id FROM "session" WHERE "userId"=$1 AND "expiresAt">CURRENT_TIMESTAMP ORDER BY "createdAt" DESC LIMIT 1',
          [f.owner.authUserId],
        )
      ).rows[0];
      return (
        await f.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS data`,
          [
            f.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].data;
    };
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      revenue = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      deferred = await f.seedAccount(prefix + ".DEF", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "DEFERRED_REVENUE",
      }),
      advance = await f.seedAccount(prefix + ".ADV", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "CLIENT_ADVANCE",
      }),
      cash = await f.seedAccount(prefix + ".BANK", { controlType: "CASH" }),
      investment = await f.seedAccount(prefix + ".INV", {
        controlType: "INVESTMENT",
      }),
      incomeControl = await f.seedAccount(prefix + ".IRECV", {
        controlType: "INVESTMENT_INCOME_RECEIVABLE",
      }),
      otherIncome = await f.seedAccount(prefix + ".INC", {
        type: "OTHER_INCOME",
        normalSide: "CREDIT",
        reportGroup: "OTHER_INCOME",
      }),
      expense = await f.seedAccount(prefix + ".EXP", {
        type: "OTHER_EXPENSE",
        reportGroup: "OTHER_EXPENSES",
      });
    const party = await command(
        "encova_finance_master_command",
        "PARTY_CREATE",
        {
          name: prefix + " client",
          legalName: "Synthetic Legal Co",
          kind: "CLIENT",
          contactEmail: "synthetic@example.test",
          phone: null,
          address: null,
          userId: null,
          reason: "Reviewed synthetic source identity",
        },
      ),
      bank = await command("encova_finance_master_command", "CASH_CREATE", {
        name: prefix + " bank",
        kind: "BANK",
        glAccountId: cash.id,
        currency: "PKR",
        maskedReference: "1234",
        reason: "Reviewed synthetic bank",
      }),
      p = await f.historicalPeriod(prefix + " source dates"),
      projectId = crypto.randomUUID();
    await f.sql.query(
      'INSERT INTO "Project"(id,name,description,"managerId","updatedAt") VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [
        projectId,
        prefix + " project",
        "Isolated actual financial dimensions",
        f.owner.id,
      ],
    );
    const holding = await command("encova_finance_holding_command", "CREATE", {
      name: prefix + " holding",
      partyId: party.id,
      investmentType: "Synthetic unit fund",
      unitMode: "UNIT",
      classification: "CURRENT",
      policyStatus: "REVIEWED",
      measurementMode: "COST",
      valuationTreatment: "PROFIT_LOSS",
      policy: "Explicit synthetic policy; no company adoption",
      evidence: "Reviewed synthetic holding mappings",
      investmentAccountId: investment.id,
      gainAccountId: otherIncome.id,
      lossAccountId: expense.id,
      feeAccountId: expense.id,
      incomeAccountId: otherIncome.id,
      incomeControlAccountId: incomeControl.id,
      valuationOffsetAccountId: null,
      impairmentAccountId: expense.id,
      reason: "Reviewed synthetic source",
    });
    const acquisition = await command(
      "encova_finance_movement_command",
      "CREATE",
      {
        kind: "INVESTMENT_ACQUISITION",
        reference: prefix + " acquisition",
        documentDate: p.start,
        postingDate: p.start,
        description: "Actual reviewed unit acquisition",
        evidence: "Reviewed synthetic source",
        currency: "PKR",
        amount: "100.01",
        feeAmount: "0.00",
        allocations: [],
        fromCashId: bank.id,
        toCashId: null,
        partyId: null,
        controlAccountId: null,
        counterAccountId: null,
        projectId: null,
        approvalEvidence: null,
        billId: null,
        loanId: null,
        holdingId: holding.id,
        units: "3.000001",
        reason: "Actual original-cost acquisition",
      },
    );
    await command("encova_finance_movement_command", "POST", {
      id: acquisition.id,
      expectedVersion: acquisition.version,
      reason: "Post actual reviewed acquisition",
    });
    const invoice = await f.create("invoices", {
      reference: prefix + " invoice",
      partyId: party.id,
      receivableAccountId: ar.id,
      projectId,
      invoiceDate: p.start,
      postingDate: p.start,
      dueDate: p.end,
      description: "Actual project earned and deferred billing",
      evidence: "Reviewed actual invoice",
      lines: [
        {
          description: "Actual earned service",
          quantity: "1",
          unitRate: "100.01",
          recognition: "EARNED",
          revenueAccountId: revenue.id,
          projectId,
        },
        {
          description: "Actual unearned billing",
          quantity: "1",
          unitRate: "40.00",
          recognition: "DEFERRED",
          revenueAccountId: revenue.id,
          deferredAccountId: deferred.id,
          projectId,
        },
      ],
      reason: "Actual dated invoice",
    });
    await f.create("invoices/" + invoice.id + "/post", {
      expectedVersion: invoice.version,
      reason: "Post actual invoice",
    });
    const line = (
        await f.sql.query(
          'SELECT id FROM "FinanceInvoiceLine" WHERE "invoiceId"=$1 AND recognition=\'EARNED\'',
          [invoice.id],
        )
      ).rows[0],
      plus = (n: number) =>
        new Date(new Date(p.start + "T00:00:00Z").getTime() + n * 86400000)
          .toISOString()
          .slice(0, 10),
      credit = await f.create("customer-credits", {
        reference: prefix + " credit",
        partyId: party.id,
        invoiceId: invoice.id,
        advanceAccountId: advance.id,
        projectId,
        documentDate: plus(2),
        postingDate: plus(2),
        description: "Actual dated earned-service credit",
        evidence: "Reviewed exact original service",
        creditLines: [{ invoiceLineId: line.id, amount: "30.00" }],
        reason: "Actual original-line credit",
      });
    await f.create("customer-credits/" + credit.id + "/post", {
      expectedVersion: credit.version,
      reason: "Post actual credit",
    });
    await f.create("customer-credits/" + credit.id + "/reverse", {
      expectedVersion: 2,
      postingDate: plus(3),
      reason: "Actual later credit opposite",
    });
    const url = (kind: string, to = p.end, q = prefix) =>
      "/finance/reports/roll-forwards/" +
      kind +
      "?" +
      new URLSearchParams({ from: p.start, to, q });
    await page.goto(url("PROJECTS", plus(2)));
    let balances = page.getByRole("region", {
      name: "Posted roll-forward balances",
      exact: true,
    });
    const incomeRow = balances
      .getByRole("row")
      .filter({ hasText: "Earned income" });
    await expect(incomeRow).toContainText("100.01");
    await expect(incomeRow).toContainText("30.00");
    await expect(incomeRow).toContainText("70.01");
    await incomeRow
      .getByRole("link", { name: "View source events", exact: true })
      .click();
    const events = page.getByRole("region", {
      name: "Roll-forward source event ledger",
      exact: true,
    });
    await expect(events.getByRole("row")).toHaveCount(3);
    await expect(events).toContainText("-30.00");
    const entries = (
        await f.sql.query(
          'SELECT e.id,e."customerDocumentId",c."reversalOfId" FROM "FinanceJournalEntry" e JOIN "FinanceCustomerDocument" c ON c.id=e."customerDocumentId" WHERE c.id=$1 OR c."reversalOfId"=$1',
          [credit.id],
        )
      ).rows,
      original = entries.find((e) => e.customerDocumentId === credit.id),
      opposite = entries.find((e) => e.reversalOfId === credit.id);
    await events
      .locator('a[href="/finance/posted-sources/' + original.id + '"]')
      .click();
    await expect(
      page.getByRole("heading", { name: "Posted source entry", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Open source workflow", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp("/finance/customer-credits/" + credit.id + "$"),
    );
    await page.goto("/finance/posted-sources/" + opposite.id);
    await expect(
      page.getByRole("link", { name: "Original posted entry", exact: true }),
    ).toHaveAttribute("href", "/finance/posted-sources/" + original.id);
    await expect(
      page.getByRole("link", {
        name: "Open original source workflow",
        exact: true,
      }),
    ).toHaveAttribute("href", "/finance/customer-credits/" + credit.id);
    await page.goto(url("INVESTMENTS"));
    balances = page.getByRole("region", {
      name: "Posted roll-forward balances",
      exact: true,
    });
    await expect(
      balances.getByRole("row").filter({ hasText: "Holding units" }),
    ).toContainText("3.000001 units");
    await expect(
      page.getByRole("region", {
        name: "Complete roll-forward metrics",
        exact: true,
      }),
    ).not.toContainText("Holding units");
    for (const name of [
      "Founder funding",
      "Loan balances",
      "Fixed assets",
      "Customer and supplier advances",
      "Project results",
      "Investments",
    ]) {
      await page
        .getByRole("navigation", { name: "Roll-forward views", exact: true })
        .getByRole("link", { name, exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: name + " roll-forward",
          exact: true,
        }),
      ).toBeVisible();
    }
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
    const get =
        "/api/v1/finance/reports/roll-forwards/INVESTMENTS?" +
        new URLSearchParams({ from: p.start, to: p.end, q: prefix }),
      r = await page.request.get(get);
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("no-store");
    expect(
      (await r.json()).data.items.find(
        (i: { metric: string }) => i.metric === "UNITS",
      ).closingBalance,
    ).toBe("3.000001");
    const lp = await lower.newPage();
    await login(lp, "e2e.member@example.test");
    for (const path of [get, "/api/v1/finance/posted-sources/" + original.id]) {
      const denied = await lp.request.get(path);
      expect(denied.status()).toBe(403);
      expect(await denied.text()).not.toContain(prefix);
    }
    await lp.goto("/finance/posted-sources/" + original.id);
    await expect(
      lp.getByRole("heading", { name: "Posted source entry", exact: true }),
    ).toHaveCount(0);
  } finally {
    await lower.close();
    await f.close();
  }
});
