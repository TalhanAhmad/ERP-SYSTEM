import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { yearDetail } from "@/modules/finance/year-closing/service";
import { closeReportTypes } from "@/modules/finance/closing/schemas";
import { reportLabels } from "@/modules/finance/reports/exports/schemas";
import { YearReopenForm } from "@/modules/finance/components/year-closing-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { ExportRows } from "@/modules/finance/components/export-view";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function SavedYearClose({
  params,
}: {
  params: Promise<{ id: string; closeId: string }>;
}) {
  const p = await params,
    d = await financePageData((a) => yearDetail(a, p.id, p.closeId));
  return (
    <section>
      <FinanceNavigation />
      <h1>Saved fiscal-year close {d.sequence}</h1>
      <p>
        <Link href={`/finance/fiscal-years/${p.id}`}>{d.year.name}</Link> ·{" "}
        {d.state}
      </p>
      {d.state === "REVERSED" && (
        <p role="status">
          Superseded annual statements — original values retained for history.
          The original closing transfer was reversed.
        </p>
      )}
      <section className="panel">
        <h2>Closing evidence</h2>
        <p>Profit or loss: PKR {d.netProfit}</p>
        <p>Closed at: {d.closedAt}</p>
        <p>Reason: {d.reason}</p>
        <p>Posting review: {d.postingReviewEvidence}</p>
        <p>Adjustment review: {d.adjustmentReviewEvidence}</p>
        <p className="preline">Snapshot proof: {d.snapshotHash}</p>
        {d.journalId ? (
          <p>
            <Link href={`/finance/posted-sources/${d.journalId}`}>
              Original closing journal
            </Link>
          </p>
        ) : (
          <p>
            No remaining income/expense balances; no zero-value journal was
            posted.
          </p>
        )}
        {d.reversalJournalId && (
          <p>
            <Link href={`/finance/posted-sources/${d.reversalJournalId}`}>
              Exact reversal journal
            </Link>
          </p>
        )}
        {d.reverseReason && <p>Reopen reason: {d.reverseReason}</p>}
        <p>
          <Link
            href={`/finance/periods/${d.periodId}/closes/${d.periodCloseId}`}
          >
            Final-period close and saved-statement exports
          </Link>
        </p>
        <ExportRows items={d.lines} />
      </section>
      <section className="panel">
        <h2>Original annual statements</h2>
        {(["BEFORE", "AFTER"] as const).map((stage) => (
          <div key={stage}>
            <h3>
              {stage === "BEFORE"
                ? "Before retained-earnings transfer"
                : "After retained-earnings transfer"}
            </h3>
            {closeReportTypes.map((t) => (
              <p key={t}>
                <Link
                  href={`/finance/fiscal-years/${p.id}/closes/${p.closeId}/reports/${t}/${stage}`}
                >
                  {stage.toLowerCase()} {reportLabels[t]}
                </Link>
              </p>
            ))}
          </div>
        ))}
      </section>
      {d.canManage && d.state === "CLOSED" && (
        <section className="panel">
          <h2>Controlled annual reopening</h2>
          <YearReopenForm value={d} hosted={env.AUTH_PROVIDER === "supabase"} />
        </section>
      )}
    </section>
  );
}
