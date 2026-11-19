import { it, expect } from "vitest";
import {
  exportRequestSchema,
  exportChangeSchema,
  exportQuerySchema,
} from "@/modules/finance/reports/exports/schemas";
import {
  csvCell,
  numericCell,
  renderExportCsv,
} from "@/modules/finance/reports/exports/format";
import { renderExportPdf } from "@/modules/finance/reports/exports/pdf";
import type { ExportSnapshot } from "@/modules/finance/reports/exports/types";
const base = {
  reportType: "TRIAL_BALANCE",
  filters: { from: "2026-01-01", to: "2026-11-17" },
  mode: "REVIEW",
  reason: "Synthetic export verification",
};
it("normalizes report filters but rejects caller readiness, snapshots, paging and fabricated identities", () => {
  expect(exportRequestSchema.parse(base)).toMatchObject({
    filters: { q: "", includeZero: "NO" },
  });
  for (const extra of [
    { actorId: crypto.randomUUID() },
    { snapshot: {} },
    { readiness: { finalEligible: true } },
    { id: crypto.randomUUID() },
  ])
    expect(exportRequestSchema.safeParse({ ...base, ...extra }).success).toBe(
      false,
    );
  for (const extra of [
    { page: 2 },
    { issuePage: 2 },
    { finalEligible: true },
    { from: "2026-02-30" },
    { from: "2027-01-01" },
  ])
    expect(
      exportRequestSchema.safeParse({
        ...base,
        filters: { ...base.filters, ...extra },
      }).success,
    ).toBe(false);
  expect(
    exportChangeSchema.safeParse({
      id: crypto.randomUUID(),
      expectedVersion: 0,
      reason: "Synthetic retry",
    }).success,
  ).toBe(false);
  expect(exportQuerySchema.safeParse({ page: 10001 }).success).toBe(false);
});
it("accepts the nine actual report types with their distinct date and dimension requirements", () => {
  for (const reportType of [
    "GENERAL_LEDGER",
    "TRIAL_BALANCE",
    "PROFIT_LOSS",
    "CASH_FLOW",
    "ROLL_FORWARD",
  ]) {
    const filters = {
      ...base.filters,
      ...(reportType === "GENERAL_LEDGER"
        ? { accountId: crypto.randomUUID() }
        : {}),
      ...(reportType === "ROLL_FORWARD" ? { kind: "INVESTMENTS" } : {}),
    };
    expect(
      exportRequestSchema.safeParse({ ...base, reportType, filters }).success,
    ).toBe(true);
  }
  for (const reportType of [
    "BALANCE_SHEET",
    "RECEIVABLES_AGEING",
    "PAYABLES_AGEING",
  ])
    expect(
      exportRequestSchema.safeParse({
        ...base,
        reportType,
        filters: { asOf: "2026-11-17" },
      }).success,
    ).toBe(true);
  expect(
    exportRequestSchema.safeParse({
      ...base,
      reportType: "BUDGET_VARIANCE",
      filters: { month: "2026-11", projectId: "SHARED" },
    }).success,
  ).toBe(true);
  for (const month of ["0000-01", "2026-13", "2026-1"])
    expect(
      exportRequestSchema.safeParse({
        ...base,
        reportType: "BUDGET_VARIANCE",
        filters: { month, projectId: "SHARED" },
      }).success,
    ).toBe(false);
});
it.each([
  "=SUM(1,2)",
  "+CMD|'x'!A1",
  "-1+2",
  "@SUM(A1)",
  " \t=2+2",
  "\tanything",
  "\r=2",
  "\n=2",
  "\uFEFF=2",
])(
  "neutralizes spreadsheet-leading text %j without losing quotes or commas",
  (value) => {
    expect(csvCell(value)).toBe("\"'" + value.replaceAll('"', '""') + '"');
  },
);
it("keeps exact signed PKR, aggregate and six-place unit cells numeric while codes and names stay text", () => {
  for (const value of ["-100.01", "999999999999999999999.99", "0.000001"]) {
    expect(csvCell(value, true)).toBe(value);
    expect(numericCell("closingBalance", value)).toBe(true);
  }
  expect(numericCell("code", "-100.01")).toBe(false);
  expect(csvCell("-100.01")).toBe('"\'-100.01"');
  expect(csvCell('one,"two"\nthree')).toBe('"one,""two""\nthree"');
});
const snapshot: ExportSnapshot = {
  schemaVersion: 1,
  reportType: "ROLL_FORWARD",
  mode: "REVIEW",
  frozen: true,
  filters: { from: "2026-01-01", to: "2026-11-17", kind: "INVESTMENTS" },
  readiness: { finalEligible: false, scope: "Complete company checks" },
  rowCount: 56,
  report: {
    metadata: {
      company: "Synthetic company",
      currency: "PKR",
      basis: "POSTED_ACCRUAL",
      timezone: "Asia/Karachi",
      from: "2026-01-01",
      to: "2026-11-17",
      filters: { kind: "INVESTMENTS" },
      generatedAt: "2026-11-17T12:00:00.000Z",
      databaseSnapshot: "1:2:",
      postingCutoffAt: null,
      postedEntryCount: 0,
      ledgerDigest: "a".repeat(64),
    },
    totals: [{ metric: "UNITS", unit: "UNITS", closingBalance: "0.000001" }],
    items: Array.from({ length: 56 }, (_, i) => ({
      name: i === 55 ? "=Last row" : "Synthetic asset " + i,
      metric: "UNITS",
      unit: "UNITS",
      closingBalance: "0.000001",
      openingBalance: "-100.01",
    })),
  },
};
it("CSV preserves metadata, filtered rows beyond page one, exact totals, unit precision and incomplete status", () => {
  const text = renderExportCsv(snapshot, "b".repeat(64)).toString("utf8");
  expect(text).toContain("INCOMPLETE");
  expect(text).toContain("POSTED_ACCRUAL");
  expect(text).toContain('56,"\'=Last row"');
  expect(text).toContain("0.000001");
  expect(text).toContain("-100.01");
  expect(text).toContain("b".repeat(64));
  expect(text).toContain('"totals.0.closingBalance",0.000001');
});
it("printable PDF embeds the font and repeats a real multi-page table without dropping later rows", async () => {
  const pdf = await renderExportPdf(snapshot, "b".repeat(64));
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const source = pdf.toString("latin1");
  expect(source).toContain("/FontFile2");
  expect((source.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(3);
  expect(pdf.length).toBeLessThan(3145728);
});
it("oversized exports fail instead of silently truncating source content", () => {
  const large = {
    ...snapshot,
    rowCount: 1,
    report: {
      ...snapshot.report,
      items: [{ description: "x".repeat(3145728) }],
    },
  };
  expect(() => renderExportCsv(large, "b".repeat(64))).toThrow(
    "FINANCE_EXPORT_LIMIT",
  );
});
