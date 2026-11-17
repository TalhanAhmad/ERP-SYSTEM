import {
  cellText,
  columnLabel,
  exportColumns,
  flatten,
} from "../reports/exports/format";
import type { ExportReadiness } from "../reports/exports/types";
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
export function ExportReadinessPanel({ value }: { value: ExportReadiness }) {
  const p = object(value.presentation),
    banks = object(value.banks),
    rolls = object(value.rollforwards),
    cash = object(value.cashFlow);
  const checks: [string, boolean][] = [
    ["Books and statement presentation", p.finalExportEligible === true],
    [
      "Receivables control reconciliation",
      object(value.receivables).ready === true,
    ],
    ["Payables control reconciliation", object(value.payables).ready === true],
    ["Cash-flow classification", cash.classificationReady === true],
    [
      "Bank reconciliations at the exact cutoff",
      banks.missing === 0 && banks.missingCashMasters === 0,
    ],
    [
      "Funding, loans, investments, assets and advances",
      Object.values(rolls).every((v) => object(v).ready === true),
    ],
    [
      "Deferred revenue and opening clearing",
      value.deferredControlIssueCount === 0 &&
        value.openingClearingBalance === "0.00",
    ],
    [
      "Cutoff available for a new final export",
      value.closedPeriodCount === 0 && value.futureCutoff === false,
    ],
  ];
  if ("approvedBudgetAvailable" in value)
    checks.push([
      "Approved budget revision and account mappings",
      value.approvedBudgetAvailable === true &&
        value.budgetMappingAvailable === true,
    ]);
  return (
    <section className="panel" aria-label="Export readiness">
      <h2>
        {value.finalEligible
          ? "Company checks passed at capture"
          : "Incomplete — final export blocked"}
      </h2>
      <p>
        Checks cover the full company regardless of displayed search filters.
        Correct underlying records through their normal review workflows; no
        balancing entries are added.
      </p>
      <ul>
        {checks.map(([label, ready]) => (
          <li key={label}>
            {ready ? "Passed" : "Review required"} — {label}
          </li>
        ))}
      </ul>
      <p>
        {String(banks.missing ?? 0)} banks need a finalized review at this
        cutoff.
      </p>
      <details>
        <summary>Readiness evidence and counts</summary>
        <ExportValues value={value} />
      </details>
    </section>
  );
}
export function ExportValues({ value }: { value: unknown }) {
  return (
    <dl>
      {flatten(value).map(([k, v]) => (
        <div key={k}>
          <dt>{columnLabel(k)}</dt>
          <dd className="preline">{cellText(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
export function ExportRows({ items }: { items: Record<string, unknown>[] }) {
  const keys = exportColumns(items);
  return (
    <div
      className="table-wrap"
      role="region"
      aria-label="Frozen export rows"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k} scope="col">
                {columnLabel(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k}>{cellText(row[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p>No rows in this selection.</p>}
    </div>
  );
}
