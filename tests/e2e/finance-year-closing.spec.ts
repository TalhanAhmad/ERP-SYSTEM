import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { closingDatabase } from "./closing-database";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("owner closes and reverses annual earnings with private retained statements and accessible mobile history", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const isolated = await closingDatabase(browser),
    page = await isolated.context.newPage();
  let fixture: Awaited<ReturnType<typeof financeFixture>> | undefined;
  try {
    fixture = await financeFixture(page, isolated.base, "e2e.finance.closing", {
      url: isolated.url,
    });
    const f = fixture,
      prefix = "CL39." + crypto.randomUUID().slice(0, 6).toUpperCase();
    const command = async (fn: string, action: string, input: unknown) => {
      // Operator fixture supplies explicit normalized defaults; checked SQL independently validates every source.
      if (
        action === "CREATE" &&
        [
          "encova_finance_invoice_command",
          "encova_finance_bill_command",
        ].includes(fn)
      ) {
        const original = input as Record<string, unknown> & {
          lines: Record<string, unknown>[];
        };
        input = {
          projectId: null,
          currency: "PKR",
          ...(fn === "encova_finance_bill_command"
            ? {
                referenceReliable: true,
                duplicateAcknowledged: false,
                cashAccountId: null,
              }
            : {}),
          ...original,
          lines: original.lines.map((line) => ({
            discountAmount: "0.00",
            taxCodeId: null,
            projectId: null,
            ...(fn === "encova_finance_invoice_command"
              ? { deferredAccountId: null }
              : {}),
            ...line,
          })),
        };
      }
      const session = (
        await f.sql.query(
          'SELECT id FROM "session" WHERE "userId"=$1 AND "expiresAt">CURRENT_TIMESTAMP ORDER BY "createdAt" DESC LIMIT 1',
          [f.owner.authUserId],
        )
      ).rows[0];
      return (
        await f.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4,$5,$6) AS data`,
          [
            f.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].data;
    };
    const ar = await f.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
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
      p = await f.historicalPeriod(prefix + " actual closing period");
    for (const side of ["AR", "AP"]) {
      const party = await command(
        "encova_finance_master_command",
        "PARTY_CREATE",
        {
          name: prefix + side,
          legalName: "Synthetic Legal Co",
          kind: side === "AR" ? "CLIENT" : "SUPPLIER",
          contactEmail: null,
          phone: null,
          address: null,
          userId: null,
          reason: "Actual synthetic close party",
        },
      );
      const d = await command(
        side === "AR"
          ? "encova_finance_invoice_command"
          : "encova_finance_bill_command",
        "CREATE",
        {
          reference: prefix + side,
          partyId: party.id,
          ...(side === "AR"
            ? { receivableAccountId: ar.id, invoiceDate: p.start }
            : { kind: "BILL", payableAccountId: ap.id, billDate: p.start }),
          postingDate: p.start,
          dueDate: p.end,
          description: "Actual source for close review",
          evidence: "Reviewed original synthetic source",
          lines: [
            {
              description: "Actual service",
              quantity: "1",
              unitRate: side === "AR" ? "100.01" : "60.00",
              ...(side === "AR"
                ? { recognition: "EARNED", revenueAccountId: revenue.id }
                : { treatment: "EXPENSE", costAccountId: expense.id }),
            },
          ],
          reason: "Create actual original source",
        },
      );
      await command(
        side === "AR"
          ? "encova_finance_invoice_command"
          : "encova_finance_bill_command",
        "POST",
        {
          id: d.id,
          expectedVersion: d.version,
          reason: "Post actual original source",
        },
      );
    }

    const retained = await f.seedAccount(prefix + ".RE", {
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
    });
    await page.goto("/finance/fiscal-years");
    await expect(
      page.getByRole("heading", { name: "Fiscal years", exact: true }),
    ).toBeVisible();
    const create = page
      .locator("form")
      .filter({
        has: page.getByRole("button", {
          name: "Create fiscal year",
          exact: true,
        }),
      });
    await create
      .getByLabel("Fiscal-year name", { exact: true })
      .fill("Browser fiscal-year fixture");
    await create.getByLabel("Fiscal-year start", { exact: true }).fill(p.start);
    await create.getByLabel("Fiscal-year end", { exact: true }).fill(p.end);
    await create
      .getByRole("combobox", { name: "Retained earnings account", exact: true })
      .selectOption(retained.id);
    await create
      .getByLabel("Fiscal calendar and mapping evidence", { exact: true })
      .fill("Synthetic reviewed calendar and equity mapping");
    await create
      .getByLabel("Reason", { exact: true })
      .fill("Configure actual synthetic annual close");
    await create
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await create
      .getByRole("button", { name: "Create fiscal year", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/fiscal-years\/[0-9a-f-]{36}$/);
    const yearId = page.url().split("/").at(-1)!;
    await expect(
      page.getByRole("heading", {
        name: "Annual checks passed — owner review required",
        exact: true,
      }),
    ).toBeVisible();
    const close = page
      .locator("form")
      .filter({
        has: page.getByRole("button", {
          name: "Close fiscal year",
          exact: true,
        }),
      });
    await close.locator('[name="postingFailuresReviewed"]').check();
    await close.locator('[name="pendingAdjustmentsReviewed"]').check();
    await close
      .getByLabel("Failed-posting review evidence", { exact: true })
      .fill("Reviewed actual source attempts and resolved outcomes");
    await close
      .getByLabel("Adjustment review evidence", { exact: true })
      .fill("Reviewed actual annual adjustments and mappings");
    await close
      .getByLabel("Reason", { exact: true })
      .fill("Close reviewed synthetic annual books");
    await close
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await close
      .getByRole("button", { name: "Close fiscal year", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Annual close 1", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Annual close 1", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Saved fiscal-year close 1",
        exact: true,
      }),
    ).toBeVisible();
    const closeId = page.url().split("/").at(-1)!;
    const api = `/api/v1/finance/fiscal-years/${yearId}/closes/${closeId}`;
    const original = (
      await (await page.request.get(api + "/reports/PROFIT_LOSS/AFTER")).json()
    ).data;
    expect(original.summary.sections.netProfit).toBe("40.01");
    await page
      .getByRole("link", { name: "Original closing journal", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: /posted/i }).first(),
    ).toBeVisible();
    await page.goto(`/finance/fiscal-years/${yearId}/closes/${closeId}`);
    await expect(
      page.getByRole("heading", {
        name: "Saved fiscal-year close 1",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const reopen = page
      .locator("form")
      .filter({
        has: page.getByRole("button", {
          name: "Reopen fiscal year",
          exact: true,
        }),
      });
    await reopen
      .getByLabel("Reason", { exact: true })
      .fill("Reopen and reverse actual retained earnings");
    await reopen
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await reopen
      .getByRole("button", { name: "Reopen fiscal year", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Superseded annual statements",
    );
    await expect(
      page.getByRole("link", { name: "Exact reversal journal", exact: true }),
    ).toBeVisible();
    const preserved = (
      await (await page.request.get(api + "/reports/PROFIT_LOSS/AFTER")).json()
    ).data;
    expect(preserved.closeState).toBe("REVERSED");
    expect(preserved.summary).toEqual(original.summary);
    expect(preserved.items).toEqual(original.items);
    expect(preserved.snapshotHash).toBe(original.snapshotHash);
    const lower = await browser.newContext({ baseURL: isolated.base });
    try {
      const member = await lower.newPage();
      await login(member, "e2e.member@example.test");
      expect((await member.request.get(api)).status()).toBe(403);
      await member.goto(`/finance/fiscal-years/${yearId}`);
      await expect(
        member.getByRole("heading", { name: /not found|couldn.t find/i }),
      ).toBeVisible();
    } finally {
      await lower.close();
    }
  } finally {
    if (fixture) await fixture.close();
    await isolated.close();
  }
});
