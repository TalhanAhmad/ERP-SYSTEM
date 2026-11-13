import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("selected administrator receives cash against multiple invoices with an explicit fee", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.receipt.ui"),
    prefix = "B13." + crypto.randomUUID().slice(0, 7).toUpperCase(),
    context = await browser.newContext();
  try {
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      rev = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      cash = await f.seedAccount(prefix + ".CASH", { controlType: "CASH" }),
      fee = await f.seedAccount(prefix + ".FEE", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      }),
      period = await f.historicalPeriod(prefix + " period");
    // Cash master is owner-only; seed through its checked DB command to reserve the
    // owner's HTTP reauth budget for the two real invoice create/post requests.
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
            reason: "Synthetic receipt UI bank",
          }),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      )
    ).rows[0].result;
    const party = await f.create("parties", {
        name: prefix + " client",
        legalName: "Synthetic Receipt Client",
        kind: "CLIENT",
        reason: "Synthetic receipt UI client",
      }),
      invoices = [];
    for (const amount of ["10000.00", "5000.00"]) {
      const d = await f.create("invoices", {
        reference: prefix,
        partyId: party.id,
        receivableAccountId: ar.id,
        invoiceDate: period.start,
        postingDate: period.start,
        dueDate: period.end,
        description: "Synthetic billed service",
        evidence: "Synthetic evidence",
        currency: "PKR",
        lines: [
          {
            description: "Earned service",
            quantity: "1",
            unitRate: amount,
            recognition: "EARNED",
            revenueAccountId: rev.id,
          },
        ],
        reason: "Reviewed UI source",
      });
      await f.create("invoices/" + d.id + "/post", {
        expectedVersion: 1,
        reason: "Bill synthetic UI source",
      });
      invoices.push(d);
    }
    const writer = await context.newPage();
    await login(writer, "e2e.finance.receipt.writer@example.test");
    await writer.goto("/finance/receipts/new");
    const form = writer.locator("form");
    for (const [label, q, id] of [
      ["Receipt client", prefix, party.id],
      ["Received into", prefix, bank.id],
    ]) {
      await form
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(q);
      await form.getByLabel(label, { exact: true }).selectOption(id);
    }
    await form.getByLabel("Bank or cash reference").fill(prefix);
    await form.getByLabel("Receipt date", { exact: true }).fill(period.start);
    await form.getByLabel("Posting date", { exact: true }).fill(period.start);
    await form.getByLabel("Cash received (PKR)").fill("11800");
    await form.getByLabel("Explicit fee (PKR)").fill("200");
    await form
      .getByLabel("Search fee expense account", { exact: true })
      .fill(prefix + ".FEE");
    await form
      .getByLabel("Fee expense account", { exact: true })
      .selectOption(fee.id);
    await form
      .getByLabel("Receipt description")
      .fill("Actual synthetic bank collection");
    await form
      .getByLabel("Supporting evidence reference")
      .fill("Synthetic bank transfer evidence");
    for (let n = 1; n <= 2; n++) {
      await form
        .getByRole("button", { name: "Add invoice allocation", exact: true })
        .click();
      await form
        .getByLabel("Invoice for allocation " + n, { exact: true })
        .selectOption(invoices[n - 1].id);
      await form
        .getByLabel("Allocation " + n + " amount (PKR)")
        .fill(n === 1 ? "10000" : "2000");
    }
    const submit = async (target: typeof form, label: string) => {
      await target
        .getByLabel("Reason", { exact: true })
        .fill("Reviewed actual cash and allocations");
      await target.getByLabel("Current password").fill(f.password);
      await target.getByRole("button", { name: label, exact: true }).click();
    };
    await submit(form, "Create receipt draft");
    await expect(writer).toHaveURL(/\/finance\/receipts\/[0-9a-f-]+$/);
    const post = writer
      .getByRole("region", { name: "Post receipt", exact: true })
      .locator("form");
    await post.getByRole("checkbox").check();
    await submit(post, "Post receipt");
    await expect(writer.getByText(/POSTED · version 2/)).toBeVisible();
    const balances = (
      await f.sql.query(
        'SELECT "invoiceId",sum(amount)::text AS amount FROM "FinanceReceivableEvent" WHERE "invoiceId"=ANY($1::uuid[]) GROUP BY "invoiceId"',
        [invoices.map((i) => i.id)],
      )
    ).rows;
    expect(balances.map((b) => b.amount).sort()).toEqual(["0.00", "3000.00"]);
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
    await writer.screenshot({
      path: test.info().outputPath("receipt-mobile.png"),
      fullPage: true,
    });
  } finally {
    await f.close();
    await context.close();
  }
});
