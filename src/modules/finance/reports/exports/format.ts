import type { ExportSnapshot } from "./types";
import { reportLabels } from "./schemas";
export const MAX_EXPORT_BYTES = 3 * 1024 * 1024;
const numericKeys = new Set(
  `debit credit balance amount originalBalance openingBookDifference closingBookDifference openingBalance closingBalance periodDebit periodCredit openingDebit openingCredit closingDebit closingCredit openingDifference periodDifference closingDifference runningBalance statementAmount originalAmount openAmount daysPastDue eventCount openDocumentCount notDue days1To30 days31To60 days61To90 over90 subledgerTotal controlTotal difference issueCount negativeDocumentCount subledgerBalance controlBalance negativeDocuments increases decreases periodNet openingSubledger openingControl closingSubledger closingControl accountCount periodEventCount budget actual remaining revenue directCosts grossProfit operatingExpenses operatingProfit otherIncome otherExpenses profitBeforeIncomeTax incomeTaxExpense netProfit currentAssets noncurrentAssets totalAssets currentLiabilities noncurrentLiabilities totalLiabilities postedEquity unclosedProfit totalEquity externalNet internalNet unclassifiedNet unclassifiedCount inflows outflows net cashChange cashLegCount total page pages sequence taxMappingVersion version revision postedEntryCount rowCount attempts missing totalAssets controlCount negativeRowCount deferredControlIssueCount openingClearingBalance closedPeriodCount missingCashMasters`.split(
    " ",
  ),
);
export const cellText = (v: unknown): string =>
  v === null || v === undefined
    ? ""
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
export const columnLabel = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
export function numericCell(key: string, value: unknown) {
  return (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (numericKeys.has(key.split(".").at(-1) ?? key) &&
      typeof value === "string" &&
      /^-?\d+(?:\.\d+)?$/.test(value))
  );
}
export function csvCell(value: unknown, numeric = false) {
  const s = cellText(value).replaceAll("\0", "\uFFFD");
  if (numeric && /^-?\d+(?:\.\d+)?$/.test(s)) return s;
  const safe =
    /^[\s\uFEFF]*[=+\-@]/u.test(s) || /^[\t\r\n]/u.test(s) ? "'" + s : s;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function flatten(value: unknown, prefix = ""): [string, unknown][] {
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      flatten(v, prefix ? prefix + "." + k : k),
    );
  return [[prefix, value]];
}
export function exportSections(snapshot: ExportSnapshot, hash: string) {
  const {
    items: _items,
    metadata,
    page: _page,
    pages: _pages,
    ...summary
  } = snapshot.report;
  void _items;
  void _page;
  void _pages;
  return [
    {
      title: "Report identity",
      rows: flatten({
        report: reportLabels[snapshot.reportType],
        mode: snapshot.mode,
        readiness: snapshot.readiness.finalEligible
          ? "Checks passed at capture"
          : "INCOMPLETE — review only",
        snapshotHash: hash,
        ...(snapshot.periodClose ? { periodClose: snapshot.periodClose } : {}),
        allFilteredRows: snapshot.rowCount,
        currencyOrUnits: "PKR unless an explicit row unit says UNITS",
        ...metadata,
        exportFilters: snapshot.filters,
        notice:
          "Frozen at generation; later postings and policies do not update this issued copy. Diagnostic lists are bounded; counts cover the full company.",
      }),
    },
    { title: "Company readiness", rows: flatten(snapshot.readiness) },
    { title: "Report totals and context", rows: flatten(summary) },
  ];
}
export const exportColumns = (items: Record<string, unknown>[]) => [
  ...new Set(items.flatMap(Object.keys)),
];
export function renderExportCsv(snapshot: ExportSnapshot, hash: string) {
  const lines: string[] = [];
  for (const section of exportSections(snapshot, hash)) {
    lines.push(
      csvCell(section.title),
      [csvCell("Field"), csvCell("Value")].join(","),
    );
    for (const [key, value] of section.rows)
      lines.push(
        [csvCell(key), csvCell(value, numericCell(key, value))].join(","),
      );
    lines.push("");
  }
  const keys = exportColumns(snapshot.report.items);
  lines.push(
    csvCell("All filtered report rows"),
    [csvCell("Row"), ...keys.map(csvCellText)].join(","),
  );
  snapshot.report.items.forEach((row, index) =>
    lines.push(
      [
        String(index + 1),
        ...keys.map((k) => csvCell(row[k], numericCell(k, row[k]))),
      ].join(","),
    ),
  );
  const data = Buffer.from("\uFEFF" + lines.join("\r\n") + "\r\n", "utf8");
  if (data.byteLength > MAX_EXPORT_BYTES)
    throw new Error("FINANCE_EXPORT_LIMIT");
  return data;
}
const csvCellText = (s: string) => csvCell(columnLabel(s));
