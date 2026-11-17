import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("private report exports preserve all filtered rows, create real CSV/PDF, block incomplete final copies and enforce mobile access", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const base = String(test.info().project.use.baseURL),
    f = await financeFixture(page, base, "e2e.finance.exports"),
    prefix = "EX38." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    lower = await browser.newContext();
  try {
    for (let i = 0; i < 27; i++)
      await f.seedAccount(prefix + "." + i, {
        name: i === 26 ? "=Formula text " + prefix : prefix + " row " + i,
      });
    const p = await f.historicalPeriod(prefix + " source dates");
    await page.goto(
      `/finance/reports/trial-balance?from=${p.start}&to=${p.end}&q=${prefix}&includeZero=YES&page=2`,
    );
    await page
      .getByRole("link", { name: "Export this report to CSV / PDF" })
      .click();
    await expect(page).toHaveURL(/\/finance\/exports\/new\?/);
    await expect(page.locator('[name="q"]')).toHaveValue(prefix);
    await expect(page.locator('[name="includeZero"]')).toHaveValue("YES");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Review all filtered synthetic accounts");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Prepare private export" }).click();
    await expect(page).toHaveURL(/\/finance\/exports\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "REVIEW · ready", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("27 filtered rows", { exact: false }),
    ).toBeVisible();
    const id = page.url().split("/").at(-1)!,
      detail = (
        await (await page.request.get(`/api/v1/finance/exports/${id}`)).json()
      ).data;
    expect(detail.filters).toMatchObject({
      q: prefix,
      includeZero: "YES",
      from: p.start,
      to: p.end,
    });
    expect(detail.items).toHaveLength(25);
    expect(detail.readiness.finalEligible).toBe(false);
    const csvEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download CSV", exact: true }).click();
    const csvDownload = await csvEvent,
      csv = await readFile((await csvDownload.path())!);
    expect(csv.toString()).toContain("'=Formula text " + prefix);
    expect(csv.toString()).toContain(prefix + " row 25");
    expect(createHash("sha256").update(csv).digest("hex")).toBe(detail.csvHash);
    const pdfEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PDF", exact: true }).click();
    const pdf = await readFile((await (await pdfEvent).path())!);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(detail.pdfHash);
    await page
      .getByRole("link", { name: "Next frozen rows", exact: true })
      .click();
    await expect(page.getByText("Page 2 of 2", { exact: false })).toBeVisible();
    const before = await (
      await page.request.get(`/api/v1/finance/exports/${id}/csv`)
    ).body();
    expect(before).toEqual(csv);
    await page.setViewportSize({ width: 375, height: 812 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(
      `/finance/exports/new?reportType=TRIAL_BALANCE&from=${p.start}&to=${p.end}&q=${prefix}`,
    );
    await page
      .getByRole("combobox", { name: "Export purpose", exact: true })
      .selectOption("FINAL");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Confirm incomplete company controls block final issuance");
    await page.getByLabel("Current password", { exact: true }).fill(f.password);
    await page.getByRole("button", { name: "Prepare private export" }).click();
    await expect(page).toHaveURL(/\/finance\/exports\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "FINAL · failed", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download PDF", exact: true }),
    ).toHaveCount(0);
    const employee = await lower.newPage();
    await login(employee, "e2e.member@example.test");
    await employee.goto(`/finance/exports/${id}`);
    await expect(
      employee.getByRole("heading", { name: /not found|couldn.t find/i }),
    ).toBeVisible();
    for (const path of ["", `/${id}`, `/${id}/csv`, `/${id}/pdf`])
      expect(
        (await employee.request.get("/api/v1/finance/exports" + path)).status(),
      ).toBe(403);
  } finally {
    await lower.close();
    await f.close();
  }
});
