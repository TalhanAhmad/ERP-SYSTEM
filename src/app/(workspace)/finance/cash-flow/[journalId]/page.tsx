import Link from "next/link";
import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { cashFlowReview } from "@/modules/finance/reports/cash-flow/service";
import { CashFlowForm } from "@/modules/finance/components/cash-flow-form";
import { FinancialSourceLink } from "@/modules/finance/components/report-primitives";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Review({
  params,
  searchParams,
}: {
  params: Promise<{ journalId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { journalId } = await params,
    q = await searchParams,
    d = await financePageData((a) => cashFlowReview(a, { ...q, journalId }));
  return (
    <section>
      <FinanceNavigation />
      <h1>Review cash classification</h1>
      <section className="panel">
        <h2>Posted cash source</h2>
        <p>
          <FinancialSourceLink
            journalId={d.source.journalId}
            type={d.source.sourceType}
            id={d.source.sourceId}
            reference={d.source.reference}
          />{" "}
          · {d.source.postingDate}
        </p>
        <p>{d.source.description}</p>
        {d.originalJournalId && (
          <p>
            This is a dated reversal. Its components inherit the original review
            with opposite signs.{" "}
            <Link href={"/finance/cash-flow/" + d.originalJournalId}>
              Review original cash source
            </Link>
          </p>
        )}
        {!d.reviewAllowed && !d.originalJournalId && (
          <p>
            Classification changes require the original and all linked reversal
            periods to be open. Opening and year-close sources use their
            controlled workflow.
          </p>
        )}
        <CashFlowForm
          key={d.basisHash}
          data={d}
          hosted={env.AUTH_PROVIDER === "supabase"}
        />
      </section>
      <section className="panel">
        <h2>Retained classification history</h2>
        <p>
          Page {d.page} · {d.total} reviewed versions
        </p>
        {d.history.map((h) => (
          <article key={h.id}>
            <h3>
              {h.state.toLowerCase()} · version {h.version}
            </h3>
            <p>{h.evidence}</p>
            <p>
              {h.reason} · {h.createdAt}
            </p>
            {h.supersedeReason && (
              <p>Replacement reason: {h.supersedeReason}</p>
            )}
            <p className="preline">Source proof {h.sourceHash}</p>
          </article>
        ))}
        <div className="form-actions">
          {d.page > 1 && (
            <Link href={"?page=" + (d.page - 1)}>
              Previous classification history
            </Link>
          )}
          {d.page * 25 < d.total && (
            <Link href={"?page=" + (d.page + 1)}>
              Next classification history
            </Link>
          )}
        </div>
      </section>
      <Link
        href={
          "/finance/reports/cash-flow?" +
          new URLSearchParams({
            from: d.source.postingDate,
            to: d.source.postingDate,
          })
        }
      >
        Cash flow for this posting date
      </Link>
    </section>
  );
}
