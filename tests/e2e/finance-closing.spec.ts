import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { closingDatabase } from "./closing-database";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("owner closes actual books, downloads retained statements, reopens with supersession and preserves mobile private history", async ({
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
    await page.goto(`/finance/periods/${p.id}/close`);
    await expect(
      page.getByRole("heading", {
        name: "Automatic checks passed — owner reviews required",
        exact: true,
      }),
    ).toBeVisible();
    const form = page.getByRole("region", { name: "Owner close confirmation" });
    await form.locator('[name="postingFailuresReviewed"]').check();
    await form.locator('[name="pendingAdjustmentsReviewed"]').check();
    await form
      .getByLabel("Failed-posting review evidence", { exact: true })
      .fill("Reviewed all actual source outcomes; no unresolved failure");
    await form
      .getByLabel("Adjustment review evidence", { exact: true })
      .fill("All actual source adjustments reviewed and complete");
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Close verified actual synthetic source period");
    await form.getByLabel("Current password", { exact: true }).fill(f.password);
    await form
      .getByRole("button", { name: "Close reviewed period", exact: true })
      .click();
    await expect(page).toHaveURL(/\/closes\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", {
        name: "Closed — saved statements",
        exact: true,
      }),
    ).toBeVisible();
    const closeId = page.url().split("/").at(-1)!;
    await page
      .getByRole("link", { name: "View saved profit and loss", exact: true })
      .click();
    await expect(
      page.getByText("40.01", { exact: true }).first(),
    ).toBeVisible();
    const original = (
      await (
        await page.request.get(
          `/api/v1/finance/periods/${p.id}/closes/${closeId}/reports/PROFIT_LOSS`,
        )
      ).json()
    ).data;
    expect(original.summary.sections.netProfit).toBe("40.01");
    await page
      .getByRole("link", { name: "Back to saved close", exact: true })
      .click();
    const exportForm = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Prepare closed-statement export",
        exact: true,
      }),
    });
    await exportForm
      .getByLabel("Reason", { exact: true })
      .fill("Export original retained close statement");
    await exportForm
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await exportForm
      .getByRole("button", {
        name: "Prepare closed-statement export",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/finance\/exports\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "FINAL · ready", exact: true }),
    ).toBeVisible();
    const exportId = page.url().split("/").at(-1)!;
    expect(
      (
        await page.request.get(`/api/v1/finance/exports/${exportId}/pdf`)
      ).status(),
    ).toBe(200);
    await page.goto(`/finance/periods/${p.id}/closes/${closeId}`);
    await expect(
      page.getByRole("heading", {
        name: "Closed — saved statements",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 800 });
    const reopenForm = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Reopen closed period",
        exact: true,
      }),
    });
    await reopenForm
      .getByLabel("Reason", { exact: true })
      .fill("Reopen for explicit reviewed correction");
    await reopenForm
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await reopenForm
      .getByRole("button", { name: "Reopen closed period", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Reopened — retained statements superseded",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await page.request.get(`/api/v1/finance/exports/${exportId}/pdf`)
      ).status(),
    ).toBe(409);
    const preserved = (
      await (
        await page.request.get(
          `/api/v1/finance/periods/${p.id}/closes/${closeId}/reports/PROFIT_LOSS`,
        )
      ).json()
    ).data;
    expect(preserved.summary).toEqual(original.summary);
    expect(preserved.items).toEqual(original.items);
    const lower = await browser.newContext({ baseURL: isolated.base });
    try {
      const member = await lower.newPage();
      await login(member, "e2e.member@example.test");
      await member.goto(`/finance/periods/${p.id}/closes/${closeId}`);
      await expect(
        member.getByRole("heading", { name: /not found|couldn.t find/i }),
      ).toBeVisible();
      expect(
        (
          await member.request.get(
            `/api/v1/finance/periods/${p.id}/closes/${closeId}`,
          )
        ).status(),
      ).toBe(403);
    } finally {
      await lower.close();
    }
  } finally {
    if (fixture) await fixture.close();
    await isolated.close();
  }
});
