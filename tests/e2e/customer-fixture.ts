import type { Page } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
export async function paidCustomerFixture(
  page: Page,
  base: string,
  username: string,
) {
  const f = await financeFixture(page, base, username),
    prefix = "B15." + crypto.randomUUID().slice(0, 7).toUpperCase();
  try {
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      revenue = await f.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      cash = await f.seedAccount(prefix + ".CASH", { controlType: "CASH" }),
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
            reason: "Synthetic customer workflow bank",
          }),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      )
    ).rows[0].result;
    const client = await f.create("parties", {
        name: prefix + " client",
        legalName: "Synthetic Customer Café",
        kind: "CLIENT",
        address: "Synthetic evidence address",
        reason: "Explicit synthetic customer",
      }),
      invoice = await f.create("invoices", {
        reference: prefix,
        partyId: client.id,
        receivableAccountId: ar.id,
        invoiceDate: period.start,
        postingDate: period.start,
        dueDate: period.end,
        description: "Synthetic billed service",
        evidence: "Synthetic supporting evidence",
        lines: [
          {
            description: "Earned service",
            quantity: "1",
            unitRate: "10000",
            recognition: "EARNED",
            revenueAccountId: revenue.id,
          },
        ],
        reason: "Reviewed synthetic billing",
      });
    await f.create("invoices/" + invoice.id + "/post", {
      expectedVersion: 1,
      reason: "Bill synthetic service",
    });
    const receipt = await f.create("receipts", {
      reference: prefix,
      partyId: client.id,
      cashAccountId: bank.id,
      documentDate: period.start,
      postingDate: period.start,
      description: "Collected actual synthetic cash",
      evidence: "Synthetic bank transfer",
      cashAmount: "10000",
      allocations: [{ invoiceId: invoice.id, amount: "10000" }],
      reason: "Reviewed synthetic collection",
    });
    await f.create("receipts/" + receipt.id + "/post", {
      expectedVersion: 1,
      reason: "Record collected cash",
    });
    const lineId = (
      await f.sql.query(
        'SELECT id FROM "FinanceInvoiceLine" WHERE "invoiceId"=$1 ORDER BY sequence LIMIT 1',
        [invoice.id],
      )
    ).rows[0].id as string;
    return {
      ...f,
      prefix,
      ar,
      revenue,
      cash,
      advance,
      period,
      bank,
      client,
      invoice,
      receipt,
      lineId,
      next: (n = 1) =>
        new Date(new Date(period.start + "T00:00:00Z").getTime() + n * 86400000)
          .toISOString()
          .slice(0, 10),
    };
  } catch (e) {
    await f.close();
    throw e;
  }
}
