import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test.use({ actionTimeout: 15000 });
test("reviewed CSV evidence recovers balance errors, reuses exact files, retains reviewed duplicates/corrections and posts no cash", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.statements",
    ),
    prefix = "SI30." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    selected = await browser.newContext(),
    manager = await browser.newContext();
  let writerId: string | undefined;
  const bytes = (ending = "\n") =>
    Buffer.from(
      [
        "Date,Amount,Description,Reference",
        "2026-11-01,10.01,Reviewed synthetic bank deposit,REF1",
        "",
      ].join(ending),
    );
  const authorize = async (form: Locator, label: string) => {
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Explicit reviewed bank statement source");
    await form.getByLabel("Current password", { exact: true }).fill(f.password);
    await form.getByRole("button", { name: label, exact: true }).click();
  };
  async function upload(
    p: Page,
    fileName: string,
    payload: Buffer,
    bankId: string,
    chooseBank = true,
  ) {
    const region = p.getByRole("region", {
      name: "Upload statement for review",
      exact: true,
    });
    if (chooseBank) {
      await region
        .getByLabel("Search statement bank/cash account", { exact: true })
        .fill(prefix);
      await expect(
        region
          .getByLabel("Statement bank/cash account", { exact: true })
          .getByRole("option")
          .filter({ hasText: prefix }),
      ).toHaveCount(1);
      await region
        .getByLabel("Statement bank/cash account", { exact: true })
        .selectOption(bankId);
    }
    await region
      .getByLabel("Statement CSV", { exact: true })
      .setInputFiles({ name: fileName, mimeType: "text/csv", buffer: payload });
    await authorize(region.locator("form"), "Upload statement for preview");
  }
  async function preview(p: Page, closing = "10.01") {
    await p
      .getByLabel("Statement start date", { exact: true })
      .fill("2026-11-01");
    await p
      .getByLabel("Statement end date", { exact: true })
      .fill("2026-11-30");
    await p
      .getByLabel("Opening statement balance (PKR)", { exact: true })
      .fill("0.00");
    await p
      .getByLabel("Closing statement balance (PKR)", { exact: true })
      .fill(closing);
    await p
      .getByRole("button", { name: "Preview mapped statement", exact: true })
      .click();
    await expect(
      p.getByRole("region", { name: "Mapped statement preview", exact: true }),
    ).toBeVisible();
  }
  try {
    const session = (
        await f.sql.query(
          'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
          [f.owner.authUserId],
        )
      ).rows[0],
      cash = await f.seedAccount(prefix + ".BANK", { controlType: "CASH" });
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
            maskedReference: "1234",
            reason: "Explicit isolated statement bank mapping",
          }),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      )
    ).rows[0].result;
    const before = (
      await f.sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"')
    ).rows[0].n;
    await page.goto("/finance/statements/import");
    await upload(page, "first.csv", bytes(), bank.id);
    await expect(
      page.getByRole("heading", {
        name: "Map and validate statement",
        exact: true,
      }),
    ).toBeVisible();
    await preview(page, "10.00");
    const confirm = () =>
      page.getByRole("region", {
        name: "Confirm statement import",
        exact: true,
      });
    await expect(
      confirm().getByRole("button", {
        name: "Import reviewed statement",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("region", {
        name: "Mapped statement preview",
        exact: true,
      }),
    ).toContainText("-0.01");
    await preview(page);
    await authorize(confirm().locator("form"), "Import reviewed statement");
    await expect(page.getByRole("heading", { name: /^STMT-/ })).toBeVisible();
    const firstId = page.url().split("/").pop(),
      firstNumber = await page
        .getByRole("heading", { name: /^STMT-/ })
        .innerText();
    await page.goto("/finance/statements/import");
    await upload(page, "first.csv", bytes(), bank.id);
    await expect(
      page.getByRole("link", { name: "Open " + firstNumber, exact: true }),
    ).toHaveAttribute("href", "/finance/statements/" + firstId);
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceStatementBatch" WHERE "cashAccountId"=$1',
          [bank.id],
        )
      ).rows[0].n,
    ).toBe(1);
    await page.goto("/finance/statements/import");
    await upload(page, "second.csv", bytes("\r\n"), bank.id);
    await preview(page);
    await expect(
      page.getByRole("region", {
        name: "Mapped statement preview",
        exact: true,
      }),
    ).toContainText("1 potential duplicate records");
    await expect(
      confirm().getByRole("button", {
        name: "Import reviewed statement",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByLabel(
        "I reviewed all 1 potential duplicate records and want to retain them.",
        { exact: true },
      )
      .check();
    await confirm()
      .getByLabel("Duplicate review reason", { exact: true })
      .fill("Reviewed overlapping evidence; retain both original bank records");
    await authorize(confirm().locator("form"), "Import reviewed statement");
    await expect(page.getByRole("heading", { name: /^STMT-/ })).toBeVisible();
    const secondId = page.url().split("/").pop();
    expect(secondId).not.toBe(firstId);
    await authorize(
      page
        .getByRole("region", { name: "Void statement source", exact: true })
        .locator("form"),
      "Void statement import",
    );
    await expect(
      page.getByRole("link", {
        name: "Create reviewed replacement",
        exact: true,
      }),
    ).toBeVisible();
    writerId = (
      await f.sql.query('SELECT id FROM "Person" WHERE username=$1', [
        "e2e.finance.statements.writer",
      ])
    ).rows[0].id;
    await f.sql.query(
      'DELETE FROM "FinanceGrant" WHERE "userId"=$1 AND "grantedById"=$2 AND reason=$3',
      [writerId, f.owner.id, "Explicit isolated statement writer"],
    );
    await f.sql.query(
      'INSERT INTO "FinanceGrant"(id,"userId","grantedById",reason) VALUES(gen_random_uuid(),$1,$2,$3)',
      [writerId, f.owner.id, "Explicit isolated statement writer"],
    );
    const w = await selected.newPage();
    await login(w, "e2e.finance.statements.writer@example.test");
    await w.goto("/finance/statements/import?replacesId=" + secondId);
    await upload(w, "replacement.csv", bytes("\r\n"), bank.id, false);
    await preview(w);
    await w
      .getByLabel(
        "I reviewed all 1 potential duplicate records and want to retain them.",
        { exact: true },
      )
      .check();
    const wc = w.getByRole("region", {
      name: "Confirm statement import",
      exact: true,
    });
    await wc
      .getByLabel("Duplicate review reason", { exact: true })
      .fill("Reviewed correction of retained prior bank evidence");
    await authorize(wc.locator("form"), "Import reviewed statement");
    await expect(w.getByRole("heading", { name: /^STMT-/ })).toBeVisible();
    const replacementId = w.url().split("/").pop();
    await expect(
      w.getByRole("link", { name: /^Retained original STMT-/ }),
    ).toHaveAttribute("href", "/finance/statements/" + secondId);
    expect(
      (
        await f.sql.query(
          'SELECT state FROM "FinanceStatementBatch" WHERE id=$1',
          [secondId],
        )
      ).rows[0].state,
    ).toBe("VOIDED");
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(before);
    expect(
      (
        await w.request.get("/api/v1/finance/statements/" + replacementId)
      ).headers()["cache-control"],
    ).toContain("no-store");
    await w.setViewportSize({ width: 390, height: 844 });
    expect(
      await w.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page: w })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const m = await manager.newPage();
    await login(m, "e2e.finance.commercial.manager@example.test");
    const denied = await m.request.get(
      "/api/v1/finance/statements/" + replacementId,
    );
    expect(denied.status()).toBe(403);
    expect(await denied.text()).not.toContain("10.01");
    expect(
      (await m.request.get("/api/v1/finance/statement-bank-options")).status(),
    ).toBe(403);
  } finally {
    await Promise.allSettled([selected.close(), manager.close()]);
    if (writerId)
      await f.sql.query(
        'DELETE FROM "FinanceGrant" WHERE "userId"=$1 AND "grantedById"=$2',
        [writerId, f.owner.id],
      );
    await f.close();
  }
});
