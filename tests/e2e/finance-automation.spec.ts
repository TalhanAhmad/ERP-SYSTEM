import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { closingDatabase } from "./closing-database";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("owner prepares recurring drafts separately from posting and recognizes delivered service with retained mobile correction history", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const isolated = await closingDatabase(browser),
    page = await isolated.context.newPage();
  let f: Awaited<ReturnType<typeof financeFixture>> | undefined;
  try {
    f = await financeFixture(page, isolated.base, "e2e.finance.closing", {
      url: isolated.url,
    });
    const prefix = "AUTO." + crypto.randomUUID().slice(0, 6).toUpperCase();
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      deferred = await f.seedAccount(prefix + ".DEF", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "DEFERRED_REVENUE",
      }),
      revenue = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      ap = await f.seedAccount(prefix + ".AP", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "PAYABLES",
      }),
      expense = await f.seedAccount(prefix + ".EXP", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      }),
      period = await f.historicalPeriod("Automation reviewed period");
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const command = async (fn: string, action: string, input: unknown) =>
      (
        await f!.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS data`,
          [
            f!.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].data;
    const party = async (kind: string) =>
        command("encova_finance_master_command", "PARTY_CREATE", {
          name: prefix + kind,
          legalName: "Synthetic automation party",
          kind,
          contactEmail: null,
          phone: null,
          address: null,
          userId: null,
          reason: "Reviewed synthetic supplier/client",
        }),
      supplier = await party("SUPPLIER"),
      client = await party("CLIENT");
    const invoice = await command("encova_finance_invoice_command", "CREATE", {
      reference: prefix + "-DEFERRED",
      partyId: client.id,
      receivableAccountId: ar.id,
      projectId: null,
      invoiceDate: period.start,
      postingDate: period.start,
      dueDate: period.end,
      description: "Actual deferred service for recognition",
      evidence: "Reviewed service obligation",
      currency: "PKR",
      reason: "Create reviewed deferred source",
      lines: [
        {
          description: "Unperformed service",
          quantity: "1",
          unitRate: "100.01",
          discountAmount: "0.00",
          taxCodeId: null,
          projectId: null,
          recognition: "DEFERRED",
          revenueAccountId: revenue.id,
          deferredAccountId: deferred.id,
        },
      ],
    });
    await command("encova_finance_invoice_command", "POST", {
      id: invoice.id,
      expectedVersion: invoice.version,
      reason: "Post original deferred obligation",
    });
    const invoiceLine = (
      await f.sql.query(
        'SELECT id FROM "FinanceInvoiceLine" WHERE "invoiceId"=$1',
        [invoice.id],
      )
    ).rows[0];
    await page.goto("/finance/automation");
    const create = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Create recurring draft schedule",
        exact: true,
      }),
    });
    await create
      .getByLabel("Schedule name", { exact: true })
      .fill("Reviewed recurring rent");
    await create
      .getByLabel("First month", { exact: true })
      .fill(period.start.slice(0, 7));
    await create
      .getByLabel("Last month (optional)", { exact: true })
      .fill(period.start.slice(0, 7));
    await create
      .getByLabel("Description", { exact: true })
      .fill("Reviewed monthly rent obligation");
    await create
      .getByLabel("Reviewed policy and source evidence")
      .fill("Owner reviewed fixed supplier obligation without assumed tax");
    for (const [label, id] of [
      ["Supplier", supplier.id],
      ["Payable account", ap.id],
      ["Expense account", expense.id],
    ]) {
      const select = create.getByLabel(label, { exact: true });
      await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
      await select.selectOption(id);
    }
    await create.getByLabel("Monthly amount (PKR)").fill("10.01");
    await create
      .getByLabel("Reason", { exact: true })
      .fill("Configure reviewed monthly draft only");
    await create
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await create
      .getByRole("button", {
        name: "Create recurring draft schedule",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/finance\/automation\/[0-9a-f-]{36}$/);
    const scheduleId = page.url().split("/").at(-1)!;
    await page.goto("/finance/automation");
    const prepare = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Prepare due drafts",
        exact: true,
      }),
    });
    await prepare
      .getByLabel("Reason", { exact: true })
      .fill("Prepare due reviewed monthly source");
    await prepare
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await prepare
      .getByRole("button", { name: "Prepare due drafts", exact: true })
      .click();
    await expect(
      prepare.getByLabel("Current password", { exact: true }),
    ).toHaveValue("");
    const run = (
      await f.sql.query(
        'SELECT id,state,"sourceId" FROM "FinanceRecurringRun" WHERE "scheduleId"=$1',
        [scheduleId],
      )
    ).rows[0];
    expect(run.state).toBe("READY");
    expect(
      (
        await f.sql.query('SELECT state FROM "FinanceBill" WHERE id=$1', [
          run.sourceId,
        ])
      ).rows[0].state,
    ).toBe("DRAFT");
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(1);
    await page.goto(`/finance/automation/runs/${run.id}`);
    await expect(
      page.getByRole("link", {
        name: "Open prepared source for independent review",
      }),
    ).toBeVisible();
    await page.goto("/finance/recognitions");
    const recognition = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Create recognition draft",
        exact: true,
      }),
    });
    await recognition
      .getByLabel("Recognition date", { exact: true })
      .fill(period.start);
    const line = recognition.getByLabel("Deferred invoice line", {
      exact: true,
    });
    await expect(line.locator(`option[value="${invoiceLine.id}"]`)).toHaveCount(
      1,
    );
    await line.selectOption(invoiceLine.id);
    await recognition.getByLabel("Amount to recognize (PKR)").fill("10.01");
    await recognition
      .getByLabel("Description", { exact: true })
      .fill("Delivered approved service portion");
    await recognition
      .getByLabel("Delivered service approval evidence")
      .fill("Client acceptance recorded for the exact delivered portion");
    await recognition
      .getByLabel("Reason", { exact: true })
      .fill("Prepare evidenced recognition for review");
    await recognition
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await recognition
      .getByRole("button", { name: "Create recognition draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/recognitions\/[0-9a-f-]{36}$/);
    const recognitionId = page.url().split("/").at(-1)!;
    const post = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Post reviewed recognition",
        exact: true,
      }),
    });
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Approve reviewed delivered service");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post reviewed recognition", exact: true })
      .click();
    await expect(
      page.getByRole("link", {
        name: "Original recognition journal",
        exact: true,
      }),
    ).toBeVisible();
    const reverse = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Reverse recognition",
        exact: true,
      }),
    });
    await reverse.getByLabel("Reversal posting date").fill(period.end);
    await reverse
      .getByLabel("Reason", { exact: true })
      .fill("Retain original and correct with dated opposite");
    await reverse
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await reverse
      .getByRole("button", { name: "Reverse recognition", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Dated opposite journal", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page
      .getByRole("link", { name: "Original recognition journal", exact: true })
      .focus();
    await expect(
      page.getByRole("link", {
        name: "Original recognition journal",
        exact: true,
      }),
    ).toBeFocused();
    await login(page, "e2e.member@example.test");
    expect(
      (
        await page.request.get(`/api/v1/finance/recognitions/${recognitionId}`)
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.get(`/api/v1/finance/automation/runs/${run.id}`)
      ).status(),
    ).toBe(403);
  } finally {
    try {
      await f?.close();
    } finally {
      await isolated.close();
    }
  }
});
