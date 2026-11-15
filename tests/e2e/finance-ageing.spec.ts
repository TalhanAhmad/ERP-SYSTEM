import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("historical ageing keeps later payments out of earlier cutoffs and exposes private dated source drill-down on mobile", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.ageing",
    ),
    prefix = "AG36." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    lower = await browser.newContext();
  try {
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const command = async (action: string, input: unknown) =>
      (
        await f.sql.query(
          "SELECT encova_finance_master_command($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS d",
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
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      income = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      cash = await f.seedAccount(prefix + ".BANK", { controlType: "CASH" }),
      party = await command("PARTY_CREATE", {
        name: prefix + " client",
        legalName: "Synthetic Legal Co",
        kind: "CLIENT",
        contactEmail: "synthetic@example.test",
        phone: null,
        address: null,
        userId: null,
        reason: "Actual dated source party",
      }),
      bank = await command("CASH_CREATE", {
        name: prefix + " bank",
        kind: "BANK",
        glAccountId: cash.id,
        currency: "PKR",
        maskedReference: "1234",
        reason: "Actual settlement bank",
      }),
      p = await f.historicalPeriod(prefix + " source dates"),
      later = new Date(
        new Date(p.start + "T00:00:00Z").getTime() + 2 * 86400000,
      )
        .toISOString()
        .slice(0, 10);
    const invoice = await f.create("invoices", {
      reference: prefix + " actual invoice",
      partyId: party.id,
      receivableAccountId: ar.id,
      invoiceDate: p.start,
      postingDate: p.start,
      dueDate: p.start,
      description: "Actual original earned billing",
      evidence: "Reviewed synthetic dated source",
      lines: [
        {
          description: "Actual service",
          quantity: "1",
          unitRate: "100.01",
          recognition: "EARNED",
          revenueAccountId: income.id,
        },
      ],
      reason: "Actual original invoice",
    });
    await f.create("invoices/" + invoice.id + "/post", {
      expectedVersion: invoice.version,
      reason: "Post actual original invoice",
    });
    const receipt = await f.create("receipts", {
      reference: prefix + " later receipt",
      partyId: party.id,
      cashAccountId: bank.id,
      documentDate: later,
      postingDate: later,
      description: "Actual later receipt",
      evidence: "Reviewed actual settlement",
      cashAmount: "20.00",
      allocations: [{ invoiceId: invoice.id, amount: "20.00" }],
      reason: "Actual later settlement",
    });
    await f.create("receipts/" + receipt.id + "/post", {
      expectedVersion: receipt.version,
      reason: "Post actual later settlement",
    });
    const url = (date: string) =>
      "/finance/reports/receivables-ageing?" +
      new URLSearchParams({ asOf: date, q: prefix });
    await page.goto(url(p.start));
    let rows = page.getByRole("region", {
      name: "Historical ageing documents",
      exact: true,
    });
    await expect(rows).toContainText("100.01");
    await expect(rows).toContainText("Not due / due today");
    await expect(
      page.getByRole("heading", {
        name: "Subledger and control accounts agree",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "View dated events", exact: true })
      .click();
    let events = page.getByRole("region", {
      name: "Dated subledger events",
      exact: true,
    });
    await expect(events.getByRole("row")).toHaveCount(2);
    await expect(events).not.toContainText("-20.00");
    await page.goto(url(later));
    rows = page.getByRole("region", {
      name: "Historical ageing documents",
      exact: true,
    });
    await expect(rows).toContainText("80.01");
    await expect(rows).toContainText("1–30 days");
    await page
      .getByRole("link", { name: "View dated events", exact: true })
      .click();
    events = page.getByRole("region", {
      name: "Dated subledger events",
      exact: true,
    });
    await expect(events.getByRole("row")).toHaveCount(3);
    await expect(events).toContainText("-20.00");
    await expect(events).toContainText("80.01");
    await expect(
      events.locator('a[href="/finance/receipts/' + receipt.id + '"]'),
    ).toHaveCount(1);
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
    const r = await page.request.get(
      "/api/v1/finance/invoices/" +
        invoice.id +
        "/ageing-events?asOf=" +
        p.start,
    );
    expect(r.headers()["cache-control"]).toContain("no-store");
    const history = (await r.json()).data;
    expect(history.document.openAmount).toBe("100.01");
    expect(history.items).toHaveLength(1);
    const lp = await lower.newPage();
    await login(lp, "e2e.member@example.test");
    for (const path of [
      "/api/v1/finance/reports/receivables-ageing?asOf=" + later,
      "/api/v1/finance/invoices/" + invoice.id + "/ageing-events?asOf=" + later,
    ]) {
      const denied = await lp.request.get(path);
      expect(denied.status()).toBe(403);
      expect(await denied.text()).not.toContain(prefix);
    }
    await lp.goto("/finance/reports/receivables-ageing");
    await expect(
      lp.getByRole("heading", { name: "Receivables ageing", exact: true }),
    ).toHaveCount(0);
  } finally {
    await lower.close();
    await f.close();
  }
});
