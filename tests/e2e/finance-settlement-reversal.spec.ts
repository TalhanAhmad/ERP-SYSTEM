import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { paidCustomerFixture } from "./customer-fixture";
import { login } from "./helpers";
test("receipt settlement release keeps cash and dated release/receipt reversals retain original sources", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const f = await paidCustomerFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.release.ui",
    ),
    context = await browser.newContext();
  try {
    const writer = await context.newPage();
    await login(writer, "e2e.finance.release.writer@example.test");
    const receiptPath = "/finance/receipts/" + f.receipt.id;
    await writer.goto(receiptPath);
    const submit = async (
      form: ReturnType<typeof writer.locator>,
      label: string,
      date: string,
    ) => {
      await form.getByLabel("Correction posting date").fill(date);
      await form.getByRole("checkbox").check();
      await form
        .getByLabel("Reason", { exact: true })
        .fill("Reviewed dated settlement correction");
      await form.getByLabel("Current password").fill(f.password);
      await form.getByRole("button", { name: label, exact: true }).click();
    };
    const release = writer
      .getByRole("region", { name: "Release invoice settlements", exact: true })
      .locator("form");
    await release
      .getByLabel("Search released client funds account", { exact: true })
      .fill(f.prefix + ".ADV");
    await release
      .getByLabel("Released client funds account", { exact: true })
      .selectOption(f.advance.id);
    await submit(release, "Release invoice settlements", f.next());
    await expect(writer).toHaveURL(
      /\/finance\/receipt-unallocations\/[0-9a-f-]+$/,
    );
    await expect(writer.getByText(/POSTED · version 2/)).toBeVisible();
    const cash = await f.sql.query(
      'SELECT sum(l.debit-l.credit)::text AS amount FROM "FinanceJournalLine" l WHERE l."accountId"=$1',
      [f.cash.id],
    );
    expect(cash.rows[0].amount).toBe("10000.00");
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
    const undo = writer
      .getByRole("region", { name: "Reverse settlement release", exact: true })
      .locator("form");
    await submit(undo, "Reverse settlement release", f.next(2));
    await expect(writer.getByText(/REVERSED · version 2/)).toBeVisible();
    await writer.goto(receiptPath);
    const reverse = writer
      .getByRole("region", { name: "Reverse receipt", exact: true })
      .locator("form");
    await submit(reverse, "Reverse receipt", f.next(3));
    await expect(writer.getByText(/REVERSED · version 2/)).toBeVisible();
    const final = (
      await f.sql.query(
        'SELECT l."accountId",sum(l.debit-l.credit)::text AS amount FROM "FinanceJournalLine" l WHERE l."accountId"=ANY($1::uuid[]) GROUP BY l."accountId"',
        [[f.cash.id, f.ar.id, f.advance.id]],
      )
    ).rows;
    expect(
      Object.fromEntries(final.map((r) => [r.accountId, r.amount])),
    ).toEqual({
      [f.cash.id]: "0.00",
      [f.ar.id]: "10000.00",
      [f.advance.id]: "0.00",
    });
    expect(
      (
        await f.sql.query(
          'SELECT state,version FROM "FinanceCustomerDocument" WHERE id=$1',
          [f.receipt.id],
        )
      ).rows[0],
    ).toEqual({ state: "POSTED", version: 2 });
  } finally {
    await f.close();
    await context.close();
  }
});
