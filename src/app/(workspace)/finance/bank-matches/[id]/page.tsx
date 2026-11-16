import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { bankMatchDetail } from "@/modules/finance/treasury/matching/service";
import {
  BankUnmatchForm,
  BankSourceLinks,
} from "@/modules/finance/components/bank-match-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Detail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData((a) => bankMatchDetail(a, id, { page: q.page })),
    i = d.item;
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.state} · version {i.version} · {i.cashAccount.name} ·{" "}
        {i.glAccount.code}
      </p>
      <section className="panel">
        <h2>Reviewed matching group</h2>
        <p>{i.description}</p>
        <p>Evidence: {i.evidence}</p>
        <p>
          Effective {i.earliestDate} — {i.latestDate} · Decision recorded{" "}
          {i.createdAt.toISOString()} by {i.createdBy.displayName}
        </p>
        {i.unmatchedAt && (
          <p>
            Undone {i.unmatchedAt.toISOString()} by {i.unmatchedBy?.displayName}
            : {i.unmatchReason}
          </p>
        )}
        <p>
          {d.total} allocations · Page {d.page} of {d.pages}
        </p>
        <ol start={(d.page - 1) * 25 + 1}>
          {d.allocations.map((a) => (
            <li key={a.id}>
              <BankSourceLinks source={a.source} />
              <p>
                Bank value date {a.source.statement.date} / cash posting date{" "}
                {a.source.cash.date} · Effective {a.effectiveDate} ·{" "}
                <MoneyCell value={a.amount} />
              </p>
              <ul>
                {a.events.map((e) => (
                  <li key={e.id}>
                    {e.kind} <MoneyCell value={e.delta} /> · effective{" "}
                    {e.effectiveDate} · decision {e.createdAt.toISOString()} by{" "}
                    {e.createdBy.displayName} · {e.reason}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className="form-actions">
          {d.page > 1 && (
            <Link href={"?page=" + (d.page - 1)}>Previous allocations</Link>
          )}
          {d.page < d.pages && (
            <Link href={"?page=" + (d.page + 1)}>Next allocations</Link>
          )}
        </div>
      </section>
      {i.state === "MATCHED" && (
        <BankUnmatchForm
          id={i.id}
          version={i.version}
          hosted={env.AUTH_PROVIDER === "supabase"}
        />
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
