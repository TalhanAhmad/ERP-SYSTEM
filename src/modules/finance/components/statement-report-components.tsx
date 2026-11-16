import Link from "next/link";
import { BalanceCell, ReportMetadataPanel } from "./report-primitives";
import { MoneyCell } from "./money-cell";
import type { ReportMetadata } from "../reports/service";
import type { StatementReadiness } from "../reports/statements/service";
const issueLabels: Record<string, string> = {
  OVERDRAFT_PRESENTATION_UNREVIEWED: "Review bank credit balance presentation",
  ACCOUNT_CLASSIFICATION_UNAVAILABLE: "Account classification unavailable",
  TAX_EXPENSE_CLASSIFICATION_UNAVAILABLE:
    "Review income-tax expense classification",
};
export function StatementReadinessPanel({
  readiness,
  metadata,
  issueHref,
  profitLoss = false,
}: {
  readiness: StatementReadiness;
  metadata: ReportMetadata;
  issueHref: (page: number) => string;
  profitLoss?: boolean;
}) {
  const r = readiness;
  return (
    <>
      <ReportMetadataPanel
        metadata={metadata}
        sourceNote={
          profitLoss
            ? "Operating income and expense exclude YEAR_CLOSE transfers and their controlled opposites. Only posted activity is included."
            : undefined
        }
      />
      <section className="panel" aria-label="Statement presentation checks">
        <h2>
          {r.finalExportEligible
            ? "Mapping and book checks pass"
            : "Presentation review required"}
        </h2>
        <p>
          {r.issueCount} presentation issues · Book difference{" "}
          <MoneyCell value={r.booksDifference} />
        </p>
        <p>
          Bank credit balance presentation:{" "}
          {r.policy.overdraftPresentation === "CURRENT_LIABILITY"
            ? "current liabilities (reviewed)"
            : "unreviewed"}
          . Policy version {r.policy.version ?? "not configured"}.
        </p>
        {!r.finalExportEligible && (
          <p className="error" role="alert">
            Resolve presentation issues and any book difference before issuing a
            final financial statement. Provisional amounts remain visible for
            review.
          </p>
        )}
        <Link href="/finance/report-settings">
          Review presentation settings
        </Link>
        <p className="preline">
          Presentation proof {String(metadata.filters.taxMappingDigest ?? "")} ·
          This does not change posted amounts.
        </p>
        {!!r.issueCount && (
          <>
            <p>
              Issues cover the full statement dataset, including accounts hidden
              by the display search. Page {r.page} of {r.pages}.
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Statement mapping issues"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Posted balance</th>
                    <th scope="col">Review needed</th>
                  </tr>
                </thead>
                <tbody>
                  {r.issues.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link
                          href={
                            "/finance/reports/general-ledger?" +
                            new URLSearchParams({
                              accountId: i.id,
                              from: "0001-01-01",
                              to: metadata.to,
                            })
                          }
                        >
                          {i.code} · {i.name}
                        </Link>
                      </td>
                      <td>
                        <BalanceCell value={i.balance} />
                      </td>
                      <td>{issueLabels[i.issue] ?? i.issue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              {r.page > 1 && (
                <Link href={issueHref(r.page - 1)}>
                  Previous presentation issues
                </Link>
              )}
              {r.page < r.pages && (
                <Link href={issueHref(r.page + 1)}>
                  Next presentation issues
                </Link>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}
