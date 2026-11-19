import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { exportDetail } from "@/modules/finance/reports/exports/service";
import { reportLabels } from "@/modules/finance/reports/exports/schemas";
import {
  ExportReadinessPanel,
  ExportRows,
  ExportValues,
} from "@/modules/finance/components/export-view";
import { ExportChangeForm } from "@/modules/finance/components/export-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
const messages: Record<string, string> = {
  FINANCE_EXPORT_INCOMPLETE:
    "Company checks are incomplete. Review the readiness details below before requesting a final copy.",
  FINANCE_EXPORT_LIMIT:
    "This report exceeds the export size limit. Narrow its date or row filters and request another copy.",
  FINANCE_EXPORT_ATTEMPTS:
    "The maximum of three processing attempts has been reached. Request a new export after reviewing the issue.",
  FINANCE_EXPORT_CLOSED_PERIOD:
    "The report overlaps a closed period. Export the saved statement from the period close history.",
};
export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData((a) => exportDetail(a, id, q)),
    hosted = env.AUTH_PROVIDER === "supabase",
    readiness = d.readiness ?? d.failureDetails;
  return (
    <section>
      <FinanceNavigation />
      <h1>{reportLabels[d.reportType]} export</h1>
      <section className="panel">
        <h2>
          {d.mode} · {d.state.toLowerCase()}
          {d.expired ? " · expired" : ""}
        </h2>
        <p>{d.reason}</p>
        <p>
          Created {d.createdAt} · Downloads expire {d.expiresAt}
        </p>
        <p>
          Processing attempts {d.attempts} of 3. Frozen copies retain their
          original source; later postings do not update them.
        </p>
        {d.errorCode && (
          <p role="alert" className="error">
            {messages[d.errorCode] ??
              "This export is unavailable. Refresh its status or request a new copy if processing cannot resume."}
          </p>
        )}
        <div className="form-actions">
          <Link href={"/finance/exports/" + id}>Refresh export status</Link>
          {d.state === "READY" && !d.expired && (
            <>
              <a href={`/api/v1/finance/exports/${id}/csv`}>Download CSV</a>
              <a href={`/api/v1/finance/exports/${id}/pdf`}>Download PDF</a>
            </>
          )}
          <Link href="/finance/exports/new">Prepare another export</Link>
        </div>
        <details>
          <summary>Original report filters and file proofs</summary>
          <ExportValues
            value={{
              filters: d.filters,
              snapshotHash: d.snapshotHash,
              csvHash: d.csvHash,
              pdfHash: d.pdfHash,
            }}
          />
        </details>
        {d.supersedeReason && <p>Superseded: {d.supersedeReason}</p>}
      </section>
      {readiness && <ExportReadinessPanel value={readiness} />}
      {d.metadata && (
        <section className="panel">
          <h2>Frozen report basis</h2>
          <ExportValues value={d.metadata} />
        </section>
      )}
      {d.summary && (
        <section className="panel">
          <h2>Frozen totals and report context</h2>
          <ExportValues value={d.summary} />
        </section>
      )}
      {d.snapshotHash && (
        <section className="panel">
          <h2>Frozen report rows</h2>
          <p>
            {d.rowCount} filtered rows · Page {d.page} of {d.pages}. CSV/PDF
            contain all filtered rows.
          </p>
          <ExportRows items={d.items} />
          {d.page > 1 && (
            <Link href={"?page=" + (d.page - 1)}>Previous frozen rows</Link>
          )}
          {d.page < d.pages && (
            <Link href={"?page=" + (d.page + 1)}>Next frozen rows</Link>
          )}
        </section>
      )}
      {d.canMutate &&
        !d.expired &&
        ["QUEUED", "FAILED", "RUNNING"].includes(d.state) && (
          <section className="panel">
            <h2>Export actions</h2>
            {d.state === "FAILED" && d.attempts < 3 && (
              <ExportChangeForm
                id={id}
                version={d.version}
                action="retry"
                hosted={hosted}
              />
            )}
            <ExportChangeForm
              id={id}
              version={d.version}
              action="cancel"
              hosted={hosted}
            />
          </section>
        )}
    </section>
  );
}
