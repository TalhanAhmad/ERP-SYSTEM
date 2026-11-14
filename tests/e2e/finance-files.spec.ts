import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
import {
  FINANCE_SCAN_FIXTURE_ID,
  FINANCE_SCAN_FIXTURE_SECRET,
} from "../helpers/storage-fixture";
test("private finance evidence uploads, verifies and downloads a large file through current-access proxy", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.files"),
    prefix = "FILE19." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    memberContext = await browser.newContext();
  try {
    await f.sql.query(
      `INSERT INTO "FinanceScanAuthority"(id,name,secret,"createdById",reason) VALUES($1,'Synthetic browser scanner',$2,$3,'Isolated browser scanner only') ON CONFLICT(id) DO UPDATE SET active=true`,
      [
        FINANCE_SCAN_FIXTURE_ID,
        Buffer.from(FINANCE_SCAN_FIXTURE_SECRET),
        f.owner.id,
      ],
    );
    const ap = await f.seedAccount(prefix + ".AP", {
        controlType: "PAYABLES",
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
      }),
      cost = await f.seedAccount(prefix + ".COST", {
        type: "OPERATING_EXPENSE",
        reportGroup: "OPERATING_EXPENSES",
      }),
      period = await f.historicalPeriod(prefix),
      party = await f.create("parties", {
        name: prefix + " supplier",
        legalName: prefix + " Supplier",
        kind: "SUPPLIER",
        reason: "Synthetic evidence source",
      }),
      bill = await f.create("bills", {
        kind: "BILL",
        reference: prefix,
        partyId: party.id,
        payableAccountId: ap.id,
        billDate: period.start,
        postingDate: period.start,
        dueDate: period.end,
        description: "Evidence test bill",
        evidence: "Synthetic browser source",
        lines: [
          {
            description: "Cost",
            quantity: "1",
            unitRate: "100",
            treatment: "EXPENSE",
            costAccountId: cost.id,
          },
        ],
        reason: "Synthetic bill",
      });
    await page.goto("/finance/bills/" + bill.id);
    const section = page.getByRole("region", {
        name: "Private financial evidence",
        exact: true,
      }),
      file = Buffer.alloc(6 * 1024 * 1024);
    Buffer.from("%PDF-1.7\nSynthetic browser evidence\n%%EOF").copy(file);
    await section
      .getByLabel("Evidence file", { exact: true })
      .setInputFiles({
        name: prefix + ".pdf",
        mimeType: "application/pdf",
        buffer: file,
      });
    await section
      .getByLabel("Evidence reason", { exact: true })
      .fill("Private synthetic purchase evidence");
    await section
      .getByLabel("Current password", { exact: true })
      .fill(f.password);
    await section
      .getByRole("button", { name: "Upload private evidence", exact: true })
      .click();
    await expect(
      section.getByRole("button", {
        name: "Download " + prefix + ".pdf",
        exact: true,
      }),
    ).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await section
      .getByRole("button", { name: "Download " + prefix + ".pdf", exact: true })
      .click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(prefix + ".pdf");
    const stream = await download.createReadStream();
    const parts: Buffer[] = [];
    for await (const part of stream!) parts.push(Buffer.from(part));
    expect(Buffer.concat(parts)).toEqual(file);
    const rows = await page.request.get(
        "/api/v1/finance/attachments?sourceType=BILL&sourceId=" + bill.id,
      ),
      item = (await rows.json()).data.items[0];
    expect(item).not.toHaveProperty("objectKey");
    expect(item).not.toHaveProperty("intentHash");
    const response = await page.request.get(
      "/api/v1/finance/attachments/" + item.id + "/download",
      { headers: { Range: "bytes=0-99" } },
    );
    expect(response.status()).toBe(206);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["content-disposition"]).toContain("attachment;");
    const member = await memberContext.newPage();
    await login(member, "e2e.member@example.test");
    expect(
      (
        await member.request.get(
          "/api/v1/finance/attachments/" + item.id + "/download",
          { headers: { Range: "bytes=0-99" } },
        )
      ).status(),
    ).toBe(403);
    // Posted source preserves evidence and removes draft-removal controls.
    await f.create("bills/" + bill.id + "/post", {
      expectedVersion: 1,
      reason: "Post reviewed source with evidence",
    });
    await page.reload();
    await expect(
      section.getByRole("button", {
        name: "Remove draft evidence",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      section.getByRole("button", {
        name: "Download " + prefix + ".pdf",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await memberContext.close();
    await f.close();
  }
});
