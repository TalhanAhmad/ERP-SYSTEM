import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { paidCustomerFixture } from "./customer-fixture";
import { login } from "./helpers";
test("paid invoice credit, private PDF, refund and dated reversals preserve the accounting history", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const f = await paidCustomerFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.credit.ui",
    ),
    context = await browser.newContext(),
    memberContext = await browser.newContext();
  try {
    const writer = await context.newPage();
    await login(writer, "e2e.finance.credit.writer@example.test");
    const pick = async (
      form: ReturnType<typeof writer.locator>,
      label: string,
      q: string,
      id: string,
    ) => {
      await form
        .getByLabel("Search " + label.toLowerCase(), { exact: true })
        .fill(q);
      await form.getByLabel(label, { exact: true }).selectOption(id);
    };
    const submit = async (
      form: ReturnType<typeof writer.locator>,
      label: string,
    ) => {
      await form
        .getByLabel("Reason", { exact: true })
        .fill("Reviewed synthetic customer transaction");
      await form.getByLabel("Current password").fill(f.password);
      await form.getByRole("button", { name: label, exact: true }).click();
    };
    await writer.goto("/finance/customer-credits/new");
    const form = writer.locator("form");
    await pick(form, "Credit client", f.prefix, f.client.id);
    await form
      .getByLabel("Credited invoice", { exact: true })
      .selectOption(f.invoice.id);
    await pick(
      form,
      "Customer credit liability",
      f.prefix + ".ADV",
      f.advance.id,
    );
    await form.getByLabel("Credit reference").fill(f.prefix);
    await form
      .getByLabel("Credit note date", { exact: true })
      .fill(f.period.start);
    await form.getByLabel("Posting date", { exact: true }).fill(f.period.start);
    await form
      .getByLabel("Document description")
      .fill("Credit eligible paid service");
    await form
      .getByLabel("Supporting evidence reference")
      .fill("Synthetic customer correction");
    await form
      .getByRole("button", { name: "Add credit line", exact: true })
      .click();
    await form
      .getByLabel("Invoice line for credit 1", { exact: true })
      .selectOption(f.lineId);
    await form.getByLabel("Credit line 1 amount (PKR)").fill("4000");
    await submit(form, "Create credit note draft");
    await expect(writer).toHaveURL(/\/finance\/customer-credits\/[0-9a-f-]+$/);
    const creditPath = new URL(writer.url()).pathname,
      creditId = creditPath.split("/").at(-1)!;
    const postCredit = writer
      .getByRole("region", { name: "Post credit note", exact: true })
      .locator("form");
    await postCredit.getByRole("checkbox").check();
    await submit(postCredit, "Post credit note");
    await expect(writer.getByText(/POSTED · version 2/)).toBeVisible();
    const downloading = writer.waitForEvent("download");
    await writer
      .getByRole("link", {
        name: "Download private credit note PDF",
        exact: true,
      })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^credit-note-.*\.pdf$/);
    expect(
      (await readFile((await download.path())!)).subarray(0, 5).toString(),
    ).toBe("%PDF-");
    await writer.goto("/finance/customer-refunds/new");
    const refund = writer.locator("form");
    await pick(refund, "Refund client", f.prefix, f.client.id);
    await refund
      .getByLabel("Refund source funds", { exact: true })
      .selectOption(creditId);
    await pick(refund, "Refund from", f.prefix, f.bank.id);
    await refund.getByLabel("Refund reference").fill(f.prefix);
    await refund
      .getByLabel("Refund date", { exact: true })
      .fill(f.period.start);
    await refund
      .getByLabel("Posting date", { exact: true })
      .fill(f.period.start);
    await refund.getByLabel("Refund amount (PKR)").fill("1500");
    await refund
      .getByLabel("Document description")
      .fill("Return part of held customer credit");
    await refund
      .getByLabel("Supporting evidence reference")
      .fill("Synthetic refund approval");
    await submit(refund, "Create customer refund draft");
    await expect(writer).toHaveURL(/\/finance\/customer-refunds\/[0-9a-f-]+$/);
    const postRefund = writer
      .getByRole("region", { name: "Post customer refund", exact: true })
      .locator("form");
    await postRefund.getByRole("checkbox").check();
    await submit(postRefund, "Post customer refund");
    await expect(writer.getByText(/POSTED · version 2/)).toBeVisible();
    const reverseRefund = writer
      .getByRole("region", { name: "Reverse customer refund", exact: true })
      .locator("form");
    await reverseRefund.getByLabel("Correction posting date").fill(f.next());
    await reverseRefund.getByRole("checkbox").check();
    await submit(reverseRefund, "Reverse customer refund");
    await expect(writer.getByText(/REVERSED · version 2/)).toBeVisible();
    await writer.goto(creditPath);
    const reverseCredit = writer
      .getByRole("region", { name: "Reverse credit note", exact: true })
      .locator("form");
    await reverseCredit.getByLabel("Correction posting date").fill(f.next());
    await reverseCredit.getByRole("checkbox").check();
    await submit(reverseCredit, "Reverse credit note");
    await expect(writer.getByText(/REVERSED · version 2/)).toBeVisible();
    const totals = async (cutoff: string) =>
      (
        await f.sql.query(
          'SELECT l."accountId",sum(l.debit-l.credit)::text AS amount FROM "FinanceJournalLine" l JOIN "FinanceJournalEntry" e ON e.id=l."journalId" WHERE l."accountId"=ANY($1::uuid[]) AND e."postingDate"<=$2::date GROUP BY l."accountId"',
          [[f.cash.id, f.revenue.id, f.ar.id, f.advance.id], cutoff],
        )
      ).rows;
    expect(
      Object.fromEntries(
        (await totals(f.period.start)).map((r) => [r.accountId, r.amount]),
      ),
    ).toEqual({
      [f.cash.id]: "8500.00",
      [f.revenue.id]: "-6000.00",
      [f.ar.id]: "0.00",
      [f.advance.id]: "-2500.00",
    });
    expect(
      Object.fromEntries(
        (await totals(f.next())).map((r) => [r.accountId, r.amount]),
      ),
    ).toEqual({
      [f.cash.id]: "10000.00",
      [f.revenue.id]: "-10000.00",
      [f.ar.id]: "0.00",
      [f.advance.id]: "0.00",
    });
    const member = await memberContext.newPage();
    await login(member, "e2e.member@example.test");
    const denied = await member.request.get(
      "/api/v1/finance/customer-credits/" + creditId + "/pdf",
    );
    expect(denied.status()).toBe(403);
    expect(denied.headers()["cache-control"]).toContain("no-store");
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
      path: test.info().outputPath("credit-note-mobile.png"),
      fullPage: true,
    });
  } finally {
    await f.close();
    await context.close();
    await memberContext.close();
  }
});
