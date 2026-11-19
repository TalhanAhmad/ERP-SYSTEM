import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { closeReport } from "@/modules/finance/closing/service";
import { reportLabels } from "@/modules/finance/reports/exports/schemas";
import { closeReportTypes } from "@/modules/finance/closing/schemas";
import {
  ExportRows,
  ExportValues,
} from "@/modules/finance/components/export-view";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function SavedReport({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; closeId: string; reportType: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await params,
    q = await searchParams,
    d = await financePageData((a) =>
      closeReport(a, p.id, p.closeId, p.reportType, q),
    ),
    t = p.reportType as (typeof closeReportTypes)[number];
  return (
    <section>
      <FinanceNavigation />
      <h1>Saved {reportLabels[t].toLowerCase()}</h1>
      <p>
        {d.closeState === "REOPENED"
          ? "Superseded close snapshot — retained for history"
          : "Original closed-period snapshot"}
      </p>
      <Link href={`/finance/periods/${p.id}/closes/${p.closeId}`}>
        Back to saved close
      </Link>
      <section className="panel">
        <h2>Frozen report basis</h2>
        <ExportValues value={d.metadata} />
      </section>
      <section className="panel">
        <h2>Saved totals and context</h2>
        <ExportValues value={d.summary} />
      </section>
      <section className="panel">
        <h2>Saved report rows</h2>
        <p>
          {d.total} rows · Page {d.page} of {d.pages}
        </p>
        <ExportRows items={d.items} />
        {d.page > 1 && (
          <Link href={"?page=" + (d.page - 1)}>Previous saved rows</Link>
        )}
        {d.page < d.pages && (
          <Link href={"?page=" + (d.page + 1)}>Next saved rows</Link>
        )}
      </section>
    </section>
  );
}
