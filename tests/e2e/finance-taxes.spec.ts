import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("Finance Owner configures tax policy; selected root posts taxed sources and evidenced withholding", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.taxes"),
    prefix = "TX18." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    wc = await browser.newContext(),
    mc = await browser.newContext();
  try {
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      ap = await f.seedAccount(prefix + ".AP", {
        controlType: "PAYABLES",
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
      }),
      revenue = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      cost = await f.seedAccount(prefix + ".COST", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      }),
      ti = await f.seedAccount(prefix + ".TI", { controlType: "TAX_INPUT" }),
      to = await f.seedAccount(prefix + ".TO", {
        controlType: "TAX_OUTPUT",
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
      }),
      wi = await f.seedAccount(prefix + ".WI", {
        controlType: "WITHHOLDING_RECEIVABLE",
      }),
      wo = await f.seedAccount(prefix + ".WO", {
        controlType: "WITHHOLDING_PAYABLE",
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
      }),
      cash = await f.seedAccount(prefix + ".CASH", { controlType: "CASH" }),
      period = await f.historicalPeriod(prefix);
    await page.goto("/finance/tax-codes?q=" + prefix);
    const form = page
      .locator("section.panel")
      .filter({
        has: page.getByRole("heading", {
          name: "Create a reviewed policy",
          exact: true,
        }),
      });
    await form.getByLabel("Policy code", { exact: true }).fill(prefix + ".TAX");
    await form
      .getByLabel("Policy name", { exact: true })
      .fill("Synthetic reviewed tax");
    await form.getByLabel("Effective from", { exact: true }).fill(period.start);
    await form
      .getByLabel("Effective to (optional)", { exact: true })
      .fill(period.end);
    await form.getByLabel("Reviewed rate (%)", { exact: true }).fill("10");
    await form
      .getByLabel("Search recoverable input control", { exact: true })
      .fill(prefix);
    await form
      .getByLabel("Recoverable input control", { exact: true })
      .selectOption(ti.id);
    await form
      .getByLabel("Search output liability control", { exact: true })
      .fill(prefix);
    await form
      .getByLabel("Output liability control", { exact: true })
      .selectOption(to.id);
    await form
      .getByLabel("Company approval and policy evidence", { exact: true })
      .fill("Synthetic evidence only, not a company tax rate");
    await form.getByRole("checkbox").check();
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Reviewed synthetic rate");
    await form.getByLabel("Current password", { exact: true }).fill(f.password);
    await form
      .getByRole("button", { name: "Create reviewed tax policy", exact: true })
      .click();
    await expect
      .poll(async () => {
        const r = await page.request.get(
          "/api/v1/finance/tax-codes?q=" + prefix,
        );
        return (await r.json()).data.items.length;
      })
      .toBe(1);
    const tax = (
      await (
        await page.request.get("/api/v1/finance/tax-codes?q=" + prefix)
      ).json()
    ).data.items[0];
    const wht = await f.create("tax-codes", {
        code: prefix + ".WHT",
        name: "Synthetic evidenced withholding",
        kind: "WITHHOLDING",
        effectiveFrom: period.start,
        effectiveTo: period.end,
        rate: "2",
        mode: "EXCLUSIVE",
        rounding: "HALF_UP",
        inputAccountId: wi.id,
        outputAccountId: wo.id,
        policyEvidence: "Synthetic certificate uses taxable service net",
        reason: "Reviewed synthetic withholding",
      }),
      party = await f.create("parties", {
        name: prefix + " party",
        legalName: prefix + " Synthetic Both",
        kind: "BOTH",
        reason: "Synthetic party",
      }),
      bank = await f.create("cash-accounts", {
        name: prefix + " bank",
        kind: "BANK",
        glAccountId: cash.id,
        reason: "Synthetic cash master",
      });
    const writer = await wc.newPage();
    await login(writer, "e2e.finance.tax.writer@example.test");
    const send = async (path: string, body: unknown) => {
      const r = await writer.request.post("/api/v1/finance/" + path, {
        headers: {
          Origin: base,
          "X-Encova-CSRF": "1",
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: { ...(body as object), reauth: { password: f.password } },
      });
      expect(r.ok()).toBe(true);
      return (await r.json()).data as { id: string; number: string };
    };
    const common = {
        reference: prefix,
        partyId: party.id,
        postingDate: period.start,
        dueDate: period.end,
        description: "Synthetic taxed source",
        evidence: "Synthetic browser evidence",
        currency: "PKR",
        reason: "Reviewed source",
      },
      line = {
        description: "Taxed service",
        quantity: "1",
        unitRate: "100",
        discountAmount: "0",
        taxCodeId: tax.id,
      };
    const invoice = await send("invoices", {
      ...common,
      invoiceDate: period.start,
      receivableAccountId: ar.id,
      lines: [{ ...line, recognition: "EARNED", revenueAccountId: revenue.id }],
    });
    await send("invoices/" + invoice.id + "/post", {
      expectedVersion: 1,
      reason: "Reviewed taxed invoice",
    });
    const bill = await send("bills", {
      ...common,
      kind: "BILL",
      billDate: period.start,
      payableAccountId: ap.id,
      lines: [{ ...line, treatment: "EXPENSE", costAccountId: cost.id }],
    });
    await send("bills/" + bill.id + "/post", {
      expectedVersion: 1,
      reason: "Reviewed taxed bill",
    });
    await writer.goto("/finance/invoices/" + invoice.id);
    await expect(writer.getByText(/Tax TX18/)).toBeVisible();
    const pdf = await writer.request.get(
      "/api/v1/finance/invoices/" + invoice.id + "/pdf",
    );
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(pdf.headers()["cache-control"]).toContain("no-store");
    await writer.goto("/finance/receipts/new");
    await writer
      .getByLabel("Search receipt client", { exact: true })
      .fill(prefix);
    await writer
      .getByLabel("Receipt client", { exact: true })
      .selectOption(party.id);
    await writer
      .getByLabel("Search received into", { exact: true })
      .fill(prefix);
    await writer
      .getByLabel("Received into", { exact: true })
      .selectOption(bank.id);
    await writer
      .getByLabel("Bank or cash reference", { exact: true })
      .fill(prefix);
    await writer.getByLabel("Receipt date", { exact: true }).fill(period.start);
    await writer.getByLabel("Posting date", { exact: true }).fill(period.start);
    await writer.getByLabel("Cash received (PKR)", { exact: true }).fill("108");
    await writer
      .getByLabel("Evidenced withholding (PKR)", { exact: true })
      .fill("2");
    await writer
      .getByLabel("Search withholding policy", { exact: true })
      .fill(prefix);
    await writer
      .getByLabel("Withholding policy", { exact: true })
      .selectOption(wht.id);
    await writer
      .getByLabel("Document description", { exact: true })
      .fill("Taxed invoice collection");
    await writer
      .getByLabel("Supporting evidence reference", { exact: true })
      .fill("Synthetic withholding certificate");
    await writer
      .getByRole("button", { name: "Add invoice allocation", exact: true })
      .click();
    await writer
      .getByLabel("Search invoice for allocation 1", { exact: true })
      .fill(invoice.number);
    await writer
      .getByLabel("Invoice for allocation 1", { exact: true })
      .selectOption(invoice.id);
    await writer
      .getByLabel("Allocation 1 amount (PKR)", { exact: true })
      .fill("110");
    await writer
      .getByLabel("Reason", { exact: true })
      .fill("Reviewed collection");
    await writer
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await writer
      .getByRole("button", { name: "Create receipt draft", exact: true })
      .click();
    await expect(writer).toHaveURL(/\/finance\/receipts\/[0-9a-f-]{36}$/);
    const post = writer.getByRole("region", {
      name: "Post receipt",
      exact: true,
    });
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Post evidenced collection");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post receipt", exact: true })
      .click();
    await expect(
      writer.getByText("POSTED · version 2 · " + period.start),
    ).toBeVisible();
    const d = (
      await (
        await writer.request.get("/api/v1/finance/invoices/" + invoice.id)
      ).json()
    ).data;
    expect(d.receivableBalance).toBe("0.00");
    const member = await mc.newPage();
    await login(member, "e2e.member@example.test");
    expect(
      (
        await member.request.get("/api/v1/finance/tax-codes?q=" + prefix)
      ).status(),
    ).toBe(403);
  } finally {
    await wc.close();
    await mc.close();
    await f.close();
  }
});
