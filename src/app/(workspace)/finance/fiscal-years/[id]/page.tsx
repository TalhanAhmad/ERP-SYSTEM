import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  yearPreview,
  yearHistory,
} from "@/modules/finance/year-closing/service";
import {
  YearCloseForm,
  YearVoidForm,
} from "@/modules/finance/components/year-closing-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { CloseChecklistPanel } from "@/modules/finance/components/close-checklist";
import { ExportRows } from "@/modules/finance/components/export-view";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function FiscalYear({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData(async (a) => ({
      preview: await yearPreview(a, id),
      history: await yearHistory(a, id, q),
    })),
    p = d.preview,
    c = p.checklist,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{p.year.name}</h1>
      <p>
        {p.year.startDate}–{p.year.endDate} · {p.year.state}
      </p>
      <p>Calendar and mapping evidence: {p.year.evidence}</p>
      <p>
        Retained earnings:{" "}
        <Link href={`/finance/accounts/${p.year.retainedAccountId}`}>
          View mapped equity account
        </Link>
      </p>
      {p.year.state === "OPEN" && (
        <>
          <section className="panel">
            <h2>
              {c.ready
                ? "Annual checks passed — owner review required"
                : "Resolve annual closing checks"}
            </h2>
            <ul>
              <li>
                Complete period coverage:{" "}
                {c.completePeriodCoverage ? "Yes" : "No"}
              </li>
              <li>
                {c.priorUnclosedPeriods} earlier periods need reviewed closes.
              </li>
              <li>
                {c.priorUnclosedIncomeAccounts} income/expense accounts have
                prior-year balances to resolve.
              </li>
              <li>
                Retained earnings mapping:{" "}
                {c.retainedMappingValid ? "Valid" : "Review required"}
              </li>
              <li>{c.invalidClosingAccounts} unavailable closing accounts.</li>
              <li>{c.lineCount} proposed closing lines (maximum 400).</li>
            </ul>
            <p>Profit or loss to transfer: PKR {p.netProfit}</p>
            {c.finalPeriod && (
              <Link href={`/finance/periods/${c.finalPeriod.id}/close`}>
                Review final period and recorded issues
              </Link>
            )}
            <ExportRows items={p.lines} />
          </section>
          {c.finalPeriod && c.periodChecklist && (
            <CloseChecklistPanel
              value={{
                period: c.finalPeriod,
                checklist: c.periodChecklist,
                canManage: p.canManage,
                basisHash: p.basisHash,
                reportRows: {},
              }}
            />
          )}{" "}
          {p.canManage && (
            <section className="panel">
              <h2>Owner annual-close confirmation</h2>
              <YearCloseForm key={p.basisHash} value={p} hosted={hosted} />
            </section>
          )}
        </>
      )}
      <section className="panel">
        <h2>Annual close history</h2>
        <p>
          {d.history.total} closes · Page {d.history.page} of {d.history.pages}
        </p>
        {d.history.items.map((x) => (
          <p key={x.id}>
            <Link href={`/finance/fiscal-years/${id}/closes/${x.id}`}>
              Annual close {x.sequence}
            </Link>{" "}
            · {x.state} · PKR {x.netProfit}
          </p>
        ))}
        {d.history.page > 1 && (
          <Link href={`?page=${d.history.page - 1}`}>
            Previous annual closes
          </Link>
        )}
        {d.history.page < d.history.pages && (
          <Link href={`?page=${d.history.page + 1}`}>Next annual closes</Link>
        )}
      </section>
      {p.canManage && p.year.state === "OPEN" && d.history.total === 0 && (
        <section className="panel">
          <h2>Correct unused configuration</h2>
          <YearVoidForm value={p.year} hosted={hosted} />
        </section>
      )}
    </section>
  );
}
