import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  journalDetail,
  journalProjects,
} from "@/modules/finance/ledger/service";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import {
  JournalForm,
  JournalAction,
} from "@/modules/finance/components/journal-forms";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Journal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    data = await financePageData((a) => journalDetail(a, id)),
    item = data.item,
    projects =
      item.state === "DRAFT" ? await financePageData(journalProjects) : [];
  const hosted = env.AUTH_PROVIDER === "supabase";
  const renderLines = (
    rows: Pick<
      (typeof item.lines)[number],
      "sequence" | "account" | "project" | "description" | "debit" | "credit"
    >[],
  ) => (
    <div
      className="table-wrap"
      role="region"
      aria-label="Journal lines table"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Description / project</th>
            <th scope="col">Debit</th>
            <th scope="col">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.sequence}>
              <td>
                {l.account.code} · {l.account.name}
              </td>
              <td>
                {l.description}
                {l.project && " · " + l.project.name}
              </td>
              <td>
                <MoneyCell value={l.debit} />
              </td>
              <td>
                <MoneyCell value={l.credit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section>
      <FinanceNavigation />
      <h1>{item.reference}</h1>
      <p>
        {item.state} · {item.postingDate.toISOString().slice(0, 10)} · PKR
      </p>
      <p>{item.description}</p>
      <p>Supporting evidence: {item.evidence}</p>
      <section className="panel" aria-label="Journal preview">
        <h2>Lines and totals</h2>
        {renderLines(item.lines)}
        <p>
          Debit <MoneyCell value={data.totals.debit} /> · Credit{" "}
          <MoneyCell value={data.totals.credit} /> ·{" "}
          {data.totals.balanced ? "Balanced" : "Not balanced"}
        </p>
      </section>
      {item.state === "DRAFT" ? (
        <>
          <section className="panel" aria-label="Edit journal draft">
            <h2>Edit draft</h2>
            <JournalForm
              key={item.version}
              item={item}
              projects={projects}
              hosted={hosted}
            />
          </section>
          <section className="panel" aria-label="Post journal">
            <h2>Post journal</h2>
            <p>
              Confirm the source, evidence, open posting date and equal totals
              above. Posting preserves these lines permanently.
            </p>
            <JournalAction item={item} action="POST" hosted={hosted} />
          </section>
          <section className="panel" aria-label="Void journal draft">
            <h2>Void draft</h2>
            <JournalAction item={item} action="VOID" hosted={hosted} />
          </section>
        </>
      ) : item.state === "POSTED" ? (
        <section className="panel" aria-label="Reverse journal">
          <h2>Reverse journal</h2>
          <p>
            Create an opposite journal in an open period, on or after the
            original date. Original lines remain in historical results.
          </p>
          <JournalAction item={item} action="REVERSE" hosted={hosted} />
        </section>
      ) : (
        <p>This source is retained and read-only.</p>
      )}
      {item.entry && (
        <section className="panel" aria-label="Posted journal">
          <h2>Posted journal</h2>
          <p>
            {item.entry.reference} ·{" "}
            {item.entry.postingDate.toISOString().slice(0, 10)}
          </p>
          {renderLines(item.entry.lines)}
          {item.entry.reversedBy && (
            <>
              <h3>Dated reversal</h3>
              <p>
                {item.entry.reversedBy.reference} ·{" "}
                {item.entry.reversedBy.postingDate.toISOString().slice(0, 10)}
              </p>
              {renderLines(item.entry.reversedBy.lines)}
            </>
          )}
        </section>
      )}
      <SetupHistory events={data.history} />
    </section>
  );
}
