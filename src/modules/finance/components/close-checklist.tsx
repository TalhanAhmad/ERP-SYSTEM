import Link from "next/link";
import type { ClosePreview } from "../closing/types";
import { ExportReadinessPanel, ExportValues } from "./export-view";
const sourcePath: Record<string, string> = {
  JOURNAL: "journals",
  INVOICE: "invoices",
  BILL: "bills",
  MOVEMENT: "movements",
  ASSET_MOVEMENT: "asset-movements",
  COST_ALLOCATION: "cost-allocations",
};
export function CloseChecklistPanel({
  value,
  saved = false,
}: {
  value: ClosePreview;
  saved?: boolean;
}) {
  const c = value.checklist;
  return (
    <>
      <section className="panel" aria-label="Period close checklist">
        <h2>
          {c.ready
            ? saved
              ? "Saved checklist — checks passed at close"
              : "Automatic checks passed — owner reviews required"
            : "Resolve checklist issues before closing"}
        </h2>
        <ul>
          <li>{c.priorOpenPeriods} earlier open periods need closing first.</li>
          <li>
            {c.pendingDrafts.total} pending posting drafts through this cutoff.
          </li>
          <li>{c.openReviewIssueCount} unresolved recorded review issues.</li>
        </ul>
        <p>
          Failed-posting and adjustment reviews require explicit owner evidence.
          Record known issues below; resolve them through the original workflows
          before confirming a close.
        </p>
        <details>
          <summary>Reviewed basis and report sizes</summary>
          <ExportValues
            value={{
              basisHash: value.basisHash,
              reportRows: value.reportRows,
              draftSourceHash: c.pendingDrafts.sourceHash,
            }}
          />
        </details>
      </section>
      <ExportReadinessPanel value={c.readiness} />
      {c.pendingDrafts.total > 0 && (
        <section className="panel">
          <h2>Pending posting drafts</h2>
          <p>
            First 25 sources; the count and close gate cover every pending
            source through the cutoff, including earlier periods.
          </p>
          <div
            className="table-wrap"
            role="region"
            aria-label="Pending close sources"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Source</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {c.pendingDrafts.items.map((i) => (
                  <tr key={i.kind + i.id}>
                    <td>{i.postingDate}</td>
                    <td>
                      {sourcePath[i.kind] ? (
                        <Link href={`/finance/${sourcePath[i.kind]}/${i.id}`}>
                          {i.reference}
                        </Link>
                      ) : (
                        <span>
                          {i.reference} · {i.id}
                        </span>
                      )}
                    </td>
                    <td>{i.kind.toLowerCase().replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
