import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { closingDatabase } from "./closing-database";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
import { execFileSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import type { seedAccountingAcceptance } from "../fixtures/finance-acceptance";
test("combined nine-source acceptance reconciles cash, closes, corrects, exports and revokes selected access", async ({
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
    const f = fixture;
    const credential = `.local/finance/browser-acceptance-${crypto.randomUUID()}.json`;
    let prepared: {
      fixture: Awaited<ReturnType<typeof seedAccountingAcceptance>>;
      reconciliationId: string;
      selectedId: string;
      selectedEmail: string;
    };
    try {
      await writeFile(
        credential,
        JSON.stringify({
          cookie: (await isolated.context.cookies())
            .map((c) => `${c.name}=${c.value}`)
            .join("; "),
          password: f.password,
        }),
        { mode: 0o600 },
      );
      prepared = JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "--conditions=react-server",
            "tests/e2e/seed-acceptance.ts",
            credential,
          ],
          { env: isolated.env, stdio: "pipe", timeout: 90000 },
        ).toString(),
      );
    } finally {
      await rm(credential, { force: true });
    }
    const data = prepared.fixture,
      p = { id: data.period.id };
    await page.goto(
      `/finance/project-results/${data.project.id}?from=2020-01-01&to=2020-01-31`,
    );
    await expect(page.getByText(/180,?000\.00/).first()).toBeVisible();
    await expect(page.getByText(/110,?000\.00/).first()).toBeVisible();
    await page.goto(`/finance/reconciliations/${prepared.reconciliationId}`);
    const finalize = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Finalize reconciliation",
        exact: true,
      }),
    });
    await finalize
      .getByLabel("Reason", { exact: true })
      .fill("Review all seven original bank legs and zero difference");
    await finalize
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await finalize
      .getByRole("button", { name: "Finalize reconciliation", exact: true })
      .click();
    await expect(page.getByText(/FINALIZED · version/).first()).toBeVisible();
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
    await expect(page.getByText(/180,?000\.00/).first()).toBeVisible();
    const original = (
      await (
        await page.request.get(
          `/api/v1/finance/periods/${p.id}/closes/${closeId}/reports/PROFIT_LOSS`,
        )
      ).json()
    ).data;
    expect(original.summary.sections.netProfit).toBe("180000.00");
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
    const closedReviewer = await browser.newContext({ baseURL: isolated.base });
    try {
      const reviewer = await closedReviewer.newPage();
      await login(reviewer, prepared.selectedEmail);
      const line = (
        await f.sql.query(
          'SELECT id FROM "FinanceInvoiceLine" WHERE "invoiceId"=$1',
          [data.invoice.id],
        )
      ).rows[0];
      const send = (path: string, body: object) =>
        reviewer.request.post(path, {
          headers: {
            origin: isolated.base,
            "x-encova-csrf": "1",
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: { ...body, reauth: { password: f.password } },
        });
      const response = await send("/api/v1/finance/customer-credits", {
        reference: "F45-CLOSED-ATTEMPT",
        partyId: data.client,
        invoiceId: data.invoice.id,
        advanceAccountId: data.accounts.clientAdvance,
        projectId: data.project.id,
        documentDate: "2020-01-20",
        postingDate: "2020-01-20",
        description: "Retained closed-period correction attempt",
        evidence: "Synthetic original source evidence",
        creditLines: [{ invoiceLineId: line.id, amount: "0.01" }],
        reason: "Prepare correction requiring owner reopening",
      });
      expect(response.status()).toBe(201);
      const draft = (await response.json()).data;
      const denied = await send(
        `/api/v1/finance/customer-credits/${draft.id}/post`,
        {
          expectedVersion: draft.version,
          reason: "Confirm closed books reject new posting",
        },
      );
      expect(denied.status()).toBe(409);
      expect((await denied.json()).error.code).toBe(
        "FINANCE_PERIOD_UNAVAILABLE",
      );
      expect(
        (
          await f.sql.query(
            'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
          )
        ).rows[0].n,
      ).toBe(9);
    } finally {
      await closedReviewer.close();
    }
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
      await login(member, prepared.selectedEmail);
      expect(
        (await member.request.get("/api/v1/finance/status")).status(),
      ).toBe(200);
      const source = (
        await f.sql.query(
          'SELECT id FROM "FinanceInvoiceLine" WHERE "invoiceId"=$1',
          [data.invoice.id],
        )
      ).rows[0];
      const mutation = async (path: string, body: unknown) =>
        member.request.post(path, {
          headers: {
            origin: isolated.base,
            "x-encova-csrf": "1",
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: { ...(body as object), reauth: { password: f.password } },
        });
      const credit = await mutation("/api/v1/finance/customer-credits", {
        reference: "F45-CORRECTION",
        partyId: data.client,
        invoiceId: data.invoice.id,
        advanceAccountId: data.accounts.clientAdvance,
        projectId: data.project.id,
        documentDate: "2020-01-20",
        postingDate: "2020-01-20",
        description: "Traceable original service correction",
        evidence: "Explicit synthetic source correction",
        creditLines: [{ invoiceLineId: source.id, amount: "0.01" }],
        reason: "Correct actual original earned service",
      });
      expect(credit.status()).toBe(201);
      const draft = (await credit.json()).data;
      const posted = await mutation(
        `/api/v1/finance/customer-credits/${draft.id}/post`,
        {
          expectedVersion: draft.version,
          reason: "Post dated correction after reviewed reopening",
        },
      );
      expect(posted.status()).toBe(200);
      await member.goto(
        "/finance/reports/profit-loss?from=2020-01-01&to=2020-01-31",
      );
      await expect(member.getByText(/179,?999\.99/).first()).toBeVisible();
      await member.goto(
        "/finance/exports/new?reportType=PROFIT_LOSS&from=2020-01-01&to=2020-01-31",
      );
      await member
        .getByLabel("Reason", { exact: true })
        .fill("Review corrected actual live statements");
      await member
        .getByLabel("Current password", { exact: true })
        .fill(f.password);
      await member
        .getByRole("button", { name: "Prepare private export", exact: true })
        .click();
      await expect(
        member.getByRole("heading", { name: "REVIEW · ready", exact: true }),
      ).toBeVisible();
      const currentExport = member.url().split("/").at(-1)!;
      expect(
        (
          await member.request.get(
            `/api/v1/finance/exports/${currentExport}/pdf`,
          )
        ).status(),
      ).toBe(200);
      const access = (
        await (await page.request.get("/api/v1/finance/access")).json()
      ).data;
      const grant = (
        await f.sql.query(
          'SELECT id,version FROM "FinanceGrant" WHERE "userId"=$1 AND "revokedAt" IS NULL',
          [prepared.selectedId],
        )
      ).rows[0];
      const revoked = await page.request.post(
        `/api/v1/finance/access/grants/${grant.id}/revoke`,
        {
          headers: {
            origin: isolated.base,
            "x-encova-csrf": "1",
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: {
            expectedVersion: access.settings.version,
            grantVersion: grant.version,
            reason: "Revoke current synthetic reviewer access",
            reauth: { password: f.password },
          },
        },
      );
      expect(revoked.status()).toBe(200);
      expect(
        (
          await member.request.get(
            `/api/v1/finance/exports/${currentExport}/pdf`,
          )
        ).status(),
      ).toBe(403);
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
    try {
      await fixture?.close();
    } finally {
      await isolated.close();
    }
  }
});
