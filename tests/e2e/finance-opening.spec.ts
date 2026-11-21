import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { closingDatabase } from "./closing-database";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
import { createHash } from "node:crypto";
test("owner uploads, reviews and posts an opening once with retained private source and accessible mobile proof", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const isolated = await closingDatabase(browser),
    page = await isolated.context.newPage();
  let f: Awaited<ReturnType<typeof financeFixture>> | undefined;
  try {
    f = await financeFixture(page, isolated.base, "e2e.finance.closing", {
      url: isolated.url,
    });
    const cash = await f.seedAccount("OPEN.CASH", {
        controlType: "CASH",
        isCashEquivalent: true,
      }),
      retained = await f.seedAccount("OPEN.EQUITY", {
        type: "EQUITY",
        normalSide: "CREDIT",
        reportGroup: "EQUITY",
      }),
      clearing = await f.seedAccount("OPEN.CLEAR", {
        type: "EQUITY",
        normalSide: "CREDIT",
        reportGroup: "EQUITY",
        controlType: "OPENING_CLEARING",
      });
    const period = await f.historicalPeriod("Reviewed opening cutover");
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const bank = (
      await f.sql.query(
        "SELECT encova_finance_master_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'CASH_CREATE',$3,$4,$5) AS data",
        [
          f.owner.id,
          session.id,
          JSON.stringify({
            name: "Imported bank",
            kind: "BANK",
            glAccountId: cash.id,
            maskedReference: null,
            currency: "PKR",
            reason: "Explicit bank cutover",
          }),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      )
    ).rows[0].data;
    const sourceText = JSON.stringify(
      {
        formatVersion: 1,
        name: "Reviewed opening browser file",
        currency: "PKR",
        cutoverDate: period.start,
        clearingAccountId: clearing.id,
        evidence: "Synthetic original evidence reviewed",
        trialBalance: [
          { accountId: cash.id, debit: "100.01", credit: "0.00" },
          { accountId: retained.id, debit: "0.00", credit: "100.01" },
        ],
        items: [
          {
            kind: "CASH",
            accountId: cash.id,
            cashAccountId: bank.id,
            reference: "ORIGINAL-BANK",
            originalDate: period.start,
            amount: "100.01",
            description: "Original reviewed bank balance",
          },
        ],
      },
      null,
      2,
    );
    await page.goto("/finance/openings");
    const upload = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Preview opening file",
        exact: true,
      }),
    });
    await upload.getByLabel("Reviewed opening file").setInputFiles({
      name: "reviewed-opening.json",
      mimeType: "application/json",
      buffer: Buffer.from(sourceText),
    });
    await upload
      .getByLabel("Reason", { exact: true })
      .fill("Review original file without journals");
    await upload
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await upload
      .getByRole("button", { name: "Preview opening file", exact: true })
      .click();
    await expect(page).toHaveURL(/\/finance\/openings\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", {
        name: "Opening checks passed — owner approval required",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(0);
    const post = page.locator("form").filter({
      has: page.getByRole("button", {
        name: "Post reviewed opening balances",
        exact: true,
      }),
    });
    await post
      .getByLabel("Cutover and reconciliation approval evidence")
      .fill("Owner reviewed original accounts and bank evidence");
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Approve explicit synthetic cutover");
    await post.getByLabel("Current password", { exact: true }).fill(f.password);
    await post
      .getByRole("button", {
        name: "Post reviewed opening balances",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Posted opening reconciliation proof",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Clearing balance: PKR 0.00", { exact: true }),
    ).toBeVisible();
    const id = page.url().split("/").at(-1)!;
    const download = await page.request.get(
      `/api/v1/finance/openings/${id}/source`,
    );
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe(sourceText);
    expect(download.headers()["x-content-sha256"]).toBe(
      createHash("sha256").update(sourceText).digest("hex"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page
      .getByRole("link", { name: "Download retained opening file" })
      .focus();
    await expect(
      page.getByRole("link", { name: "Download retained opening file" }),
    ).toBeFocused();
    await login(page, "e2e.member@example.test");
    expect(
      (
        await page.request.get(`/api/v1/finance/openings/${id}/source`)
      ).status(),
    ).toBe(403);
  } finally {
    await f?.close();
    await isolated.close();
  }
});
