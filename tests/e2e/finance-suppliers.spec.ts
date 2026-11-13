import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("supplier payment form and private credit/refund retain cost and cash history", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.suppliers"),
    prefix = "S17." + crypto.randomUUID().slice(0, 7).toUpperCase(),
    wc = await browser.newContext();
  try {
    const ap = await f.seedAccount(prefix + ".AP", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "PAYABLES",
      }),
      cost = await f.seedAccount(prefix + ".COST", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      }),
      advance = await f.seedAccount(prefix + ".ADV", {
        controlType: "SUPPLIER_ADVANCE",
      }),
      cash = await f.seedAccount(prefix + ".CASH", { controlType: "CASH" }),
      period = await f.historicalPeriod(prefix),
      party = await f.create("parties", {
        name: prefix + " supplier",
        legalName: prefix + " Supplier Legal",
        kind: "SUPPLIER",
        reason: "Synthetic supplier",
      }),
      bank = await f.create("cash-accounts", {
        name: prefix + " bank",
        kind: "BANK",
        glAccountId: cash.id,
        reason: "Synthetic bank",
      });
    const b = await f.create("bills", {
      kind: "BILL",
      reference: prefix,
      partyId: party.id,
      payableAccountId: ap.id,
      billDate: period.start,
      postingDate: period.start,
      dueDate: period.end,
      description: "Synthetic bill",
      evidence: "Browser fixture",
      currency: "PKR",
      lines: [
        {
          description: "Cost",
          quantity: "1",
          unitRate: "100",
          discountAmount: "0",
          treatment: "EXPENSE",
          costAccountId: cost.id,
        },
      ],
      reason: "Synthetic bill",
    });
    await f.create("bills/" + b.id + "/post", {
      expectedVersion: 1,
      reason: "Reviewed bill",
    });
    const writer = await wc.newPage();
    await login(writer, "e2e.finance.supplier.writer@example.test");
    await writer.goto("/finance/supplier-payments/new");
    await expect(
      writer.getByRole("heading", { name: "New payment draft" }),
    ).toBeVisible();
    await writer
      .getByLabel("Search payment supplier", { exact: true })
      .fill(prefix);
    await writer
      .getByLabel("Payment supplier", { exact: true })
      .selectOption(party.id);
    await writer.getByLabel("Search paid from", { exact: true }).fill(prefix);
    await writer.getByLabel("Paid from", { exact: true }).selectOption(bank.id);
    await writer
      .getByLabel("Bank or cash reference", { exact: true })
      .fill(prefix);
    await writer.getByLabel("Payment date", { exact: true }).fill(period.start);
    await writer.getByLabel("Posting date", { exact: true }).fill(period.start);
    await writer.getByLabel("Cash paid (PKR)", { exact: true }).fill("100");
    await writer
      .getByLabel("Document description", { exact: true })
      .fill("Browser supplier payment");
    await writer
      .getByLabel("Supporting evidence reference", { exact: true })
      .fill("Browser evidence");
    await writer.getByRole("button", { name: "Add bill allocation" }).click();
    await writer
      .getByLabel("Search bill for allocation 1", { exact: true })
      .fill("BIL-");
    await writer
      .getByLabel("Bill for allocation 1", { exact: true })
      .selectOption(b.id);
    await writer
      .getByLabel("Allocation 1 amount (PKR)", { exact: true })
      .fill("100");
    await writer.getByLabel("Reason", { exact: true }).fill("Reviewed payment");
    await writer
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await writer
      .getByRole("button", { name: "Create payment draft", exact: true })
      .click();
    await expect(writer).toHaveURL(
      /\/finance\/supplier-payments\/[0-9a-f-]{36}$/,
    );
    const post = writer.getByRole("region", {
      name: "Post payment",
      exact: true,
    });
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Post reviewed payment");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", { name: "Post payment", exact: true })
      .click();
    await expect(
      writer.getByText("POSTED · version 2 · " + period.start),
    ).toBeVisible();
    const detail = (
      await (await writer.request.get("/api/v1/finance/bills/" + b.id)).json()
    ).data;
    expect(detail.payableBalance).toBe("0.00");
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
      return (await r.json()).data;
    };
    const common = {
      reference: prefix,
      partyId: party.id,
      documentDate: period.start,
      postingDate: period.start,
      description: "Supplier correction",
      evidence: "Browser evidence",
      currency: "PKR",
      reason: "Reviewed correction",
    };
    const c = await send("supplier-credits", {
      ...common,
      billId: b.id,
      advanceAccountId: advance.id,
      creditLines: [{ billLineId: detail.item.lines[0].id, amount: "30.00" }],
    });
    await send("supplier-credits/" + c.id + "/post", {
      expectedVersion: 1,
      reason: "Reviewed credit",
    });
    const r = await send("supplier-refunds", {
      ...common,
      sourceDocumentId: c.id,
      cashAccountId: bank.id,
      cashAmount: "30.00",
    });
    await send("supplier-refunds/" + r.id + "/post", {
      expectedVersion: 1,
      reason: "Reviewed refund",
    });
    await writer.goto("/finance/supplier-refunds/" + r.id);
    await expect(writer.getByRole("heading", { name: /SRF-/ })).toBeVisible();
  } finally {
    await wc.close();
    await f.close();
  }
});
