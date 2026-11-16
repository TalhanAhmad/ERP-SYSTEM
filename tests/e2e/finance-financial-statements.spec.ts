import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("financial statements show accrual profit, require reviewed presentation and map actual tax cost once with private mobile access", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.statements.reports",
    ),
    prefix = "FS34." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    lower = await browser.newContext();
  const priorPolicy = (
    await f.sql.query(
      'SELECT "overdraftPresentation",evidence FROM "FinanceStatementPolicy"',
    )
  ).rows[0];
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
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS result`,
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
    const prefixAccount = async (
      code: string,
      patch: Record<string, unknown> = {},
    ) => f.seedAccount(prefix + code, patch);
    const bgl = await prefixAccount(".BANK", { controlType: "CASH" }),
      fgl = await prefixAccount(".FROM", { controlType: "CASH" }),
      ar = await prefixAccount(".AR", { controlType: "RECEIVABLES" }),
      income = await prefixAccount(".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      ap = await prefixAccount(".AP", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "PAYABLES",
      }),
      direct = await prefixAccount(".COST", {
        type: "DIRECT_COST",
        reportGroup: "DIRECT_COSTS",
      }),
      tax = await prefixAccount(".TAX", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      });
    const banks = [];
    for (const [n, gl] of [bgl, fgl].entries())
      banks.push(
        await command("encova_finance_master_command", "CASH_CREATE", {
          name: prefix + " bank " + n,
          kind: "BANK",
          glAccountId: gl.id,
          currency: "PKR",
          maskedReference: "1234",
          reason: "Explicit synthetic bank classification source",
        }),
      );
    const parties = [];
    for (const kind of ["CLIENT", "SUPPLIER"])
      parties.push(
        await command("encova_finance_master_command", "PARTY_CREATE", {
          name: prefix + " " + kind,
          legalName: "Synthetic Legal Co",
          kind,
          contactEmail: "synthetic@example.test",
          phone: null,
          address: null,
          userId: null,
          reason: "Explicit actual synthetic billing party",
        }),
      );
    const period = await f.historicalPeriod(prefix + " report dates"),
      invoice = await command("encova_finance_invoice_command", "CREATE", {
        reference: prefix + " unpaid invoice",
        partyId: parties[0].id,
        receivableAccountId: ar.id,
        projectId: null,
        invoiceDate: period.start,
        postingDate: period.start,
        dueDate: period.end,
        description: "Actual earned unpaid billing",
        evidence: "Reviewed synthetic source",
        currency: "PKR",
        lines: [
          {
            description: "Actual earned service",
            quantity: "1",
            unitRate: "100.01",
            discountAmount: "0.00",
            taxCodeId: null,
            recognition: "EARNED",
            revenueAccountId: income.id,
            deferredAccountId: null,
            projectId: null,
          },
        ],
        reason: "Recognize actual earned billing",
      });
    await command("encova_finance_invoice_command", "POST", {
      id: invoice.id,
      expectedVersion: invoice.version,
      reason: "Explicit actual invoice posting",
    });
    const bill = await command("encova_finance_bill_command", "CREATE", {
      kind: "BILL",
      reference: prefix + " unpaid cost",
      referenceReliable: true,
      duplicateAcknowledged: false,
      partyId: parties[1].id,
      payableAccountId: ap.id,
      cashAccountId: null,
      projectId: null,
      billDate: period.start,
      postingDate: period.start,
      dueDate: period.end,
      description: "Actual incurred unpaid costs",
      evidence: "Reviewed synthetic supplier source",
      currency: "PKR",
      lines: [
        {
          description: "Actual direct cost",
          quantity: "1",
          unitRate: "60.00",
          discountAmount: "0.00",
          taxCodeId: null,
          treatment: "EXPENSE",
          costAccountId: direct.id,
          projectId: null,
        },
        {
          description: "Actual recorded income-tax expense",
          quantity: "1",
          unitRate: "7.00",
          discountAmount: "0.00",
          taxCodeId: null,
          treatment: "EXPENSE",
          costAccountId: tax.id,
          projectId: null,
        },
      ],
      reason: "Recognize actual incurred costs",
    });
    await command("encova_finance_bill_command", "POST", {
      id: bill.id,
      expectedVersion: bill.version,
      reason: "Explicit actual bill posting",
    });
    const m = await command("encova_finance_movement_command", "CREATE", {
      kind: "TRANSFER",
      reference: prefix + " cash source",
      currency: "PKR",
      feeAmount: "0.00",
      allocations: [],
      fromCashId: banks[1].id,
      toCashId: banks[0].id,
      amount: "1.00",
      documentDate: period.start,
      postingDate: period.start,
      description: "Actual synthetic bank transfer",
      evidence: "Reviewed actual cash source",
      reason: "Create real presentation exception",
    });
    await command("encova_finance_movement_command", "POST", {
      id: m.id,
      expectedVersion: m.version,
      reason: "Explicit actual bank posting",
    });
    await command("encova_finance_statement_settings_command", "POLICY_SET", {
      overdraftPresentation: "UNREVIEWED",
      expectedVersion:
        (await f.sql.query('SELECT version FROM "FinanceStatementPolicy"'))
          .rows[0]?.version ?? null,
      evidence: "No synthetic overdraft presentation decision recorded yet",
      reason: "Prepare explicit presentation review",
    });
    const before = (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
      plUrl =
        "/finance/reports/profit-loss?" +
        new URLSearchParams({ from: period.start, to: period.end }),
      bsUrl =
        "/finance/reports/balance-sheet?" +
        new URLSearchParams({ asOf: period.end });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(plUrl);
    const line = (region: ReturnType<typeof page.getByRole>, label: string) =>
      region
        .locator("dl > div")
        .filter({ has: page.getByText(label, { exact: true }) });
    const result = () =>
      page.getByRole("region", {
        name: "Complete company profit and loss",
        exact: true,
      });
    await expect(line(result(), "Earned revenue")).toContainText("PKR 100.01");
    await expect(line(result(), "Direct costs")).toContainText("PKR 60.00");
    await expect(line(result(), "Operating expenses")).toContainText(
      "PKR 7.00",
    );
    await expect(line(result(), "Net profit / (loss)")).toContainText(
      "PKR 33.01",
    );
    await expect(
      page.getByRole("region", {
        name: "Statement presentation checks",
        exact: true,
      }),
    ).toContainText("Presentation review required");
    await page.goto("/finance/report-settings");
    const form = (label: string) =>
        page.locator("form").filter({
          has: page.getByRole("button", { name: label, exact: true }),
        }),
      authorize = async (label: string) => {
        const r = form(label);
        await r
          .getByLabel("Reason", { exact: true })
          .fill("Explicit company presentation review for synthetic books");
        await r
          .getByLabel("Current password", { exact: true })
          .fill(f.password);
        await r.getByRole("button", { name: label, exact: true }).click();
      };
    await page
      .getByLabel("Bank credit balance presentation", { exact: true })
      .selectOption("CURRENT_LIABILITY");
    await page
      .getByLabel("Presentation evidence", { exact: true })
      .fill(
        "Reviewed synthetic bank credit balances present under current liabilities",
      );
    await authorize("Save statement presentation");
    await expect(
      page.getByText("Current presentation: current liabilities (reviewed)", {
        exact: false,
      }),
    ).toBeVisible();
    const taxRegion = page.getByRole("region", {
      name: "Income-tax expense presentation",
      exact: true,
    });
    await taxRegion
      .getByLabel("Search income-tax expense account", { exact: true })
      .fill(prefix + ".TAX");
    const picker = taxRegion.getByLabel("Income-tax expense account", {
      exact: true,
    });
    await expect(
      picker.getByRole("option").filter({ hasText: prefix }),
    ).toHaveCount(1);
    await picker.selectOption(tax.id);
    await expect(
      taxRegion.getByRole("button", {
        name: "Save income-tax presentation",
        exact: true,
      }),
    ).toBeEnabled();
    await taxRegion
      .getByLabel("Income-tax presentation evidence", { exact: true })
      .fill(
        "Explicit classification of the7.00 actual income-tax expense already recorded",
      );
    await authorize("Save income-tax presentation");
    await expect(
      page.getByRole("region", { name: "Income-tax mappings", exact: true }),
    ).toContainText(prefix + ".TAX");
    await page.goto(plUrl);
    await expect(line(result(), "Operating expenses")).toContainText(
      "PKR 0.00",
    );
    await expect(line(result(), "Income-tax expense")).toContainText(
      "PKR 7.00",
    );
    await expect(line(result(), "Net profit / (loss)")).toContainText(
      "PKR 33.01",
    );
    await expect(
      page.getByRole("region", {
        name: "Statement presentation checks",
        exact: true,
      }),
    ).toContainText("Mapping and book checks pass");
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto(bsUrl);
    const position = page.getByRole("region", {
      name: "Complete company balance sheet",
      exact: true,
    });
    await expect(line(position, "Balance-sheet difference")).toContainText(
      "PKR 0.00",
    );
    await page
      .getByLabel("Filter displayed accounts", { exact: true })
      .fill(prefix + ".AR");
    await page
      .getByRole("button", { name: "Show balance sheet", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Balance sheet accounts", exact: true })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(/\/finance\/reports\/general-ledger\?/);
    await expect(
      page.getByRole("region", { name: "Ledger account totals", exact: true }),
    ).toContainText("PKR 100.01 DR");
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(before);
    const lp = await lower.newPage();
    await login(lp, "e2e.finance.commercial.manager@example.test");
    const denied = await lp.request.get(
      "/api/v1/finance/reports/profit-loss?" +
        new URLSearchParams({ from: period.start, to: period.end }),
    );
    expect([403, 404]).toContain(denied.status());
    expect(denied.headers()["cache-control"]).toContain("no-store");
  } finally {
    await Promise.allSettled([lower.close()]);
    try {
      const p = (
          await f.sql.query('SELECT version FROM "FinanceStatementPolicy"')
        ).rows[0],
        session = (
          await f.sql.query(
            'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
            [f.owner.authUserId],
          )
        ).rows[0];
      if (p && session)
        await f.sql.query(
          "SELECT encova_finance_statement_settings_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'POLICY_SET',$3,$4,$5)",
          [
            f.owner.id,
            session.id,
            JSON.stringify({
              overdraftPresentation:
                priorPolicy?.overdraftPresentation ?? "UNREVIEWED",
              evidence:
                priorPolicy?.evidence ??
                "Restore unreviewed synthetic policy without real company adoption",
              expectedVersion: p.version,
              reason:
                "Restore prior synthetic presentation after browser acceptance",
            }),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        );
    } finally {
      await f.close();
    }
  }
});
