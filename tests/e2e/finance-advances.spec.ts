import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("held client advance applies through the UI without receiving cash twice", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.advance.ui"),
    prefix = "B14." + crypto.randomUUID().slice(0, 7).toUpperCase(),
    context = await browser.newContext();
  try {
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      revenue = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      cash = await f.seedAccount(prefix + ".BANK", { controlType: "CASH" }),
      advance = await f.seedAccount(prefix + ".ADV", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "CLIENT_ADVANCE",
      }),
      period = await f.historicalPeriod(prefix + " period");
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const bank = (
      await f.sql.query(
        "SELECT encova_finance_master_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'CASH_CREATE',$3::jsonb,$4,$5) AS result",
        [
          f.owner.id,
          session.id,
          JSON.stringify({
            name: prefix + " bank",
            kind: "BANK",
            glAccountId: cash.id,
            currency: "PKR",
            reason: "Synthetic advance bank",
          }),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      )
    ).rows[0].result;
    const client = await f.create("parties", {
        name: prefix + " client",
        legalName: "Synthetic Advance Client",
        kind: "CLIENT",
        reason: "Synthetic client",
      }),
      invoice = await f.create("invoices", {
        reference: prefix,
        partyId: client.id,
        receivableAccountId: ar.id,
        invoiceDate: period.start,
        postingDate: period.start,
        dueDate: period.end,
        description: "Synthetic service",
        evidence: "Synthetic evidence",
        lines: [
          {
            description: "Earned",
            quantity: "1",
            unitRate: "10000",
            recognition: "EARNED",
            revenueAccountId: revenue.id,
          },
        ],
        reason: "Synthetic invoice",
      });
    await f.create("invoices/" + invoice.id + "/post", {
      expectedVersion: 1,
      reason: "Bill synthetic service",
    });
    const receipt = await f.create("receipts", {
      reference: prefix,
      partyId: client.id,
      cashAccountId: bank.id,
      advanceAccountId: advance.id,
      documentDate: period.start,
      postingDate: period.start,
      description: "Held client money",
      evidence: "Synthetic bank transfer",
      cashAmount: "10000",
      allocations: [],
      reason: "Received held client money",
    });
    await f.create("receipts/" + receipt.id + "/post", {
      expectedVersion: 1,
      reason: "Record actual held cash",
    });
    const writer = await context.newPage();
    await login(writer, "e2e.finance.advance.writer@example.test");
    await writer.goto("/finance/advance-applications/new");
    const form = writer.locator("form");
    await form
      .getByLabel("Search application client", { exact: true })
      .fill(prefix);
    await form
      .getByLabel("Application client", { exact: true })
      .selectOption(client.id);
    await form
      .getByLabel("Source advance", { exact: true })
      .selectOption(receipt.id);
    await form
      .getByLabel("Application reference")
      .fill(prefix + " application");
    await form
      .getByLabel("Application date", { exact: true })
      .fill(period.start);
    await form.getByLabel("Posting date", { exact: true }).fill(period.start);
    await form
      .getByLabel("Document description")
      .fill("Apply part of held balance");
    await form
      .getByLabel("Supporting evidence reference")
      .fill("Synthetic allocation approval");
    await form
      .getByRole("button", { name: "Add invoice allocation", exact: true })
      .click();
    await form
      .getByLabel("Invoice for allocation 1", { exact: true })
      .selectOption(invoice.id);
    await form.getByLabel("Allocation 1 amount (PKR)").fill("6000");
    const submit = async (target: typeof form, label: string) => {
      await target
        .getByLabel("Reason", { exact: true })
        .fill("Reviewed held client funds");
      await target.getByLabel("Current password").fill(f.password);
      await target.getByRole("button", { name: label, exact: true }).click();
    };
    await submit(form, "Create advance application draft");
    await expect(writer).toHaveURL(
      /\/finance\/advance-applications\/[0-9a-f-]+$/,
    );
    const post = writer
      .getByRole("region", { name: "Post advance application", exact: true })
      .locator("form");
    await post.getByRole("checkbox").check();
    await submit(post, "Post advance application");
    await expect(writer.getByText(/POSTED · version 2/)).toBeVisible();
    const amounts = (
      await f.sql.query(
        'SELECT "accountId",sum(debit-credit)::text AS amount FROM "FinanceJournalLine" WHERE "journalId" IN(SELECT id FROM "FinanceJournalEntry" WHERE "customerDocumentId" IN($1,$2)) GROUP BY "accountId"',
        [receipt.id, new URL(writer.url()).pathname.split("/").at(-1)],
      )
    ).rows;
    expect(
      Object.fromEntries(amounts.map((r) => [r.accountId, r.amount])),
    ).toEqual({
      [cash.id]: "10000.00",
      [advance.id]: "-4000.00",
      [ar.id]: "-6000.00",
    });
    await writer.setViewportSize({ width: 360, height: 800 });
    expect(
      (
        await new AxeBuilder({ page: writer })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await writer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await f.close();
    await context.close();
  }
});
