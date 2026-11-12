import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test.use({ actionTimeout: 10000 });
test("journal draft edit, confirmed post, dated reversal, batch void and accessible current-access drawer", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const base = String(test.info().project.use.baseURL),
    fixture = await financeFixture(page, base, "e2e.finance.ledger"),
    prefix = "B09." + crypto.randomUUID().slice(0, 7).toUpperCase();
  const writerContext = await browser.newContext(),
    writer = await writerContext.newPage();
  const authorize = async (
    form: ReturnType<typeof page.locator>,
    label: string,
  ) => {
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Reviewed synthetic browser journal");
    await form.getByLabel("Current password").fill(fixture.password);
    await form.getByRole("button", { name: label, exact: true }).click();
  };
  try {
    const dr = await fixture.create(
        "accounts",
        fixture.accountBody(prefix + ".DR", {
          type: "OPERATING_EXPENSE",
          reportGroup: "OPERATING_EXPENSES",
        }),
      ),
      cr = await fixture.create(
        "accounts",
        fixture.accountBody(prefix + ".CR", {
          type: "LIABILITY",
          normalSide: "CREDIT",
          reportGroup: "CURRENT_LIABILITIES",
        }),
      ),
      period = await fixture.historicalPeriod(prefix + " period");
    await login(writer, "e2e.finance.writer@example.test");
    await writer.goto("/finance/journals/new");
    const create = writer
      .getByRole("region", { name: "Create journal draft", exact: true })
      .locator("form");
    await create.getByLabel("Source reference").fill(prefix + ".EDIT");
    await create.getByLabel("Posting date", { exact: true }).fill(period.start);
    await create
      .getByLabel("Description", { exact: true })
      .fill("Synthetic expense accrual");
    await create
      .getByLabel("Supporting evidence reference")
      .fill("Synthetic fixture receipt reference");
    await create.getByRole("button", { name: "Add journal line" }).click();
    await create.getByRole("button", { name: "Add journal line" }).click();
    for (const [n, account, code] of [
      [1, dr, prefix + ".DR"],
      [2, cr, prefix + ".CR"],
    ] as const) {
      await create
        .getByLabel("Search account for line " + n, { exact: true })
        .fill(code);
      await create
        .getByLabel("Account for line " + n, { exact: true })
        .selectOption(account.id);
      await create
        .getByLabel(`Line ${n} description`, { exact: true })
        .fill("Accrual fixture line " + n);
    }
    await create.getByLabel("Line 1 debit (PKR)").fill("120.00");
    await create.getByLabel("Line 2 credit (PKR)").fill("1.00");
    await authorize(create, "Create draft");
    await expect(writer).toHaveURL(/\/finance\/journals\/[0-9a-f-]+$/);
    const draftPath = new URL(writer.url()).pathname;
    await expect(
      writer.getByRole("region", { name: "Journal preview" }),
    ).toContainText("Not balanced");
    await writer.goto("/finance/journals?q=" + prefix + ".EDIT");
    await writer
      .getByRole("link", { name: prefix + ".EDIT", exact: true })
      .click();
    const draftDrawer = writer.getByRole("dialog");
    await draftDrawer
      .getByRole("button", { name: "Edit draft", exact: true })
      .click();
    const edit = draftDrawer
      .getByRole("region", { name: "Edit journal draft", exact: true })
      .locator("form");
    await edit.getByLabel("Line 2 credit (PKR)").fill("120.00");
    await authorize(edit, "Save draft");
    await expect(
      draftDrawer.getByRole("heading", { name: "Summary", exact: true }),
    ).toBeVisible();
    await writer.keyboard.press("Escape");
    await writer.goto(draftPath);
    await expect(
      writer.getByRole("region", { name: "Journal preview" }),
    ).not.toContainText("Not balanced");
    const post = writer
      .getByRole("region", { name: "Post journal", exact: true })
      .locator("form");
    await post.getByRole("checkbox").check();
    await post
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic post confirmation");
    await post.getByLabel("Current password").fill("Wrong-synthetic-password");
    await post
      .getByRole("button", { name: "Post journal", exact: true })
      .click();
    await expect(post.getByRole("alert")).toContainText(
      "password could not be verified",
    );
    await authorize(post, "Post journal");
    await expect(
      writer.getByRole("region", { name: "Posted journal", exact: true }),
    ).toBeVisible();
    await expect(
      writer.getByRole("region", { name: "Edit journal draft" }),
    ).toHaveCount(0);
    const reversal = writer
      .getByRole("region", { name: "Reverse journal", exact: true })
      .locator("form");
    const next = new Date(new Date(period.start).getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
    await reversal.getByLabel("Reversal posting date").fill(next);
    await reversal.getByRole("checkbox").check();
    await authorize(reversal, "Reverse journal");
    await expect(
      writer.getByText("REVERSED", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      writer.getByRole("heading", { name: "Dated reversal" }),
    ).toBeVisible();
    for (let n = 0; n < 2; n++)
      await fixture.create("journals", {
        reference: prefix + ".BATCH" + n,
        description: "Unposted batch fixture",
        evidence: "Fixture only",
        postingDate: period.start,
        currency: "PKR",
        reason: "Create two voidable drafts",
        lines: [
          {
            accountId: dr.id,
            description: "Dr",
            debit: "10.00",
            credit: "0.00",
            projectId: null,
          },
          {
            accountId: cr.id,
            description: "Cr",
            debit: "0.00",
            credit: "10.00",
            projectId: null,
          },
        ],
      });
    await page.goto("/finance/journals?q=" + prefix + ".BATCH");
    await page
      .getByText("Void selected drafts", { exact: true })
      .first()
      .click();
    const batch = page.locator("details").locator("form");
    await batch.getByLabel(prefix + ".BATCH0", { exact: true }).check();
    await batch.getByLabel(prefix + ".BATCH1", { exact: true }).check();
    await authorize(batch, "Void selected drafts");
    await expect(
      page
        .getByRole("table")
        .getByRole("cell", { name: "VOIDED", exact: true }),
    ).toHaveCount(2);
    await writer.setViewportSize({ width: 360, height: 800 });
    await writer.goto("/finance/journals?q=" + prefix + ".EDIT");
    const link = writer.getByRole("link", {
      name: prefix + ".EDIT",
      exact: true,
    });
    await link.click();
    const drawer = writer.getByRole("dialog");
    await expect(
      drawer.getByRole("heading", { name: "Summary", exact: true }),
    ).toBeVisible();
    await drawer.getByRole("button", { name: "Journal", exact: true }).click();
    await expect(
      drawer.getByRole("heading", { name: "Dated reversal" }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page: writer })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const table = drawer
      .getByRole("region", { name: "Detail lines table" })
      .first();
    await table.focus();
    await writer.keyboard.press("ArrowRight");
    await expect
      .poll(() => table.evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(0);
    await writer.screenshot({
      path: test.info().outputPath("journal-drawer-mobile.png"),
      fullPage: false,
    });
    await writer.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await expect(link).toBeFocused();
    expect(
      await writer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const noJs = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await writer.context().storageState(),
    });
    try {
      const staticPage = await noJs.newPage();
      await staticPage.goto(draftPath);
      await expect(
        staticPage.getByRole("heading", {
          name: prefix + ".EDIT",
          includeHidden: true,
        }),
      ).toHaveCount(1);
    } finally {
      await noJs.close();
    }
    const person = (
      await fixture.sql.query('SELECT id FROM "Person" WHERE username=$1', [
        "e2e.finance.writer",
      ])
    ).rows[0];
    await fixture.sql.query(
      'UPDATE "FinanceGrant" SET "revokedAt"=CURRENT_TIMESTAMP,"revokedById"=$2,version=version+1 WHERE "userId"=$1 AND "revokedAt" IS NULL',
      [person.id, fixture.owner.id],
    );
    await link.click();
    await expect(drawer.getByRole("alert")).toContainText(
      "Finance access is unavailable",
    );
    await expect(
      drawer.getByRole("button", { name: "Journal", exact: true }),
    ).toHaveCount(0);
  } finally {
    try {
      await fixture.close();
    } finally {
      await writerContext.close();
    }
  }
});
