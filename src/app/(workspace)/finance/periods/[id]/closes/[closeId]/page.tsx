import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { closeDetail } from "@/modules/finance/closing/service";
import { closeReportTypes } from "@/modules/finance/closing/schemas";
import { reportLabels } from "@/modules/finance/reports/exports/schemas";
import {
  PeriodReopenForm,
  CloseExportForm,
} from "@/modules/finance/components/closing-forms";
import { ExportValues } from "@/modules/finance/components/export-view";
import { CloseChecklistPanel } from "@/modules/finance/components/close-checklist";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Close({
  params,
}: {
  params: Promise<{ id: string; closeId: string }>;
}) {
  const p = await params,
    d = await financePageData((a) => closeDetail(a, p.id, p.closeId)),
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>Period close {d.sequence}</h1>
      <section className="panel">
        <h2>
          {d.state === "CLOSED"
            ? "Closed — saved statements"
            : "Reopened — retained statements superseded"}
        </h2>
        <p>
          {d.period.name} · {d.startDate} through {d.endDate}
        </p>
        <p>
          Closed {d.closedAt} · {d.reason}
        </p>
        {d.reopenedAt && (
          <p>
            Reopened {d.reopenedAt} · {d.reopenReason}
          </p>
        )}
        <Link href={`/finance/periods/${p.id}/close`}>
          Review period and close history
        </Link>
        <details>
          <summary>Source and snapshot proofs</summary>
          <ExportValues
            value={{
              basisHash: d.basisHash,
              snapshotHash: d.snapshotHash,
              postingReviewEvidence: d.postingReviewEvidence,
              adjustmentReviewEvidence: d.adjustmentReviewEvidence,
            }}
          />
        </details>
        <ul>
          {closeReportTypes.map((t) => (
            <li key={t}>
              <Link
                href={`/finance/periods/${p.id}/closes/${p.closeId}/reports/${t}`}
              >
                View saved {reportLabels[t].toLowerCase()}
              </Link>{" "}
              · {d.reportRows[t]} rows
            </li>
          ))}
        </ul>
      </section>
      <CloseChecklistPanel
        saved
        value={{
          period: d.period,
          canManage: d.canManage,
          checklist: d.checklist,
          basisHash: d.basisHash,
          reportRows: d.reportRows,
        }}
      />
      {d.state === "CLOSED" && d.period.state === "CLOSED" && (
        <section className="panel">
          <h2>Export saved statement</h2>
          <CloseExportForm value={d} hosted={hosted} />
        </section>
      )}
      {d.canManage && d.state === "CLOSED" && d.period.state === "CLOSED" && (
        <section className="panel">
          <h2>Owner reopen confirmation</h2>
          <PeriodReopenForm value={d} hosted={hosted} />
        </section>
      )}
    </section>
  );
}
