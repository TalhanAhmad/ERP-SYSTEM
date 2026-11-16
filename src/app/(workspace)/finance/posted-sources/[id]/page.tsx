import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { postedSource } from "@/modules/finance/reports/rollforwards/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { ReportMetadataPanel } from "@/modules/finance/components/report-primitives";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function PostedSource({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData((a) => postedSource(a, { ...q, id }));
  return (
    <section>
      <FinanceNavigation />
      <h1>Posted source entry</h1>
      <section className="panel">
        <h2>{d.entry.reference}</h2>
        <p>
          Posting date {d.entry.postingDate} ·{" "}
          {d.entry.sourceType.replaceAll("_", " ").toLowerCase()}
        </p>
        <p>{d.entry.description}</p>
        <p>Evidence: {d.entry.evidence}</p>
        <p>
          Posted by {d.entry.postedBy} · {d.entry.postedAt}
        </p>
        <div className="form-actions">
          {d.workflow && (
            <Link className="button secondary" href={d.workflow.href}>
              {d.workflow.original
                ? "Open original source workflow"
                : "Open source workflow"}
            </Link>
          )}
          {d.entry.originalJournalId && (
            <Link href={"/finance/posted-sources/" + d.entry.originalJournalId}>
              Original posted entry
            </Link>
          )}
        </div>
        <p>
          This is the actual retained posted journal. A correction has its own
          dated opposite; the original amounts remain unchanged.
        </p>
        <dl>
          <div>
            <dt>Total debits</dt>
            <dd>
              <MoneyCell value={d.debitTotal} />
            </dd>
          </div>
          <div>
            <dt>Total credits</dt>
            <dd>
              <MoneyCell value={d.creditTotal} />
            </dd>
          </div>
          <div>
            <dt>Entry difference</dt>
            <dd>
              <MoneyCell value={d.difference} />
            </dd>
          </div>
        </dl>
      </section>
      <ReportMetadataPanel
        metadata={d.metadata}
        sourceNote="This entry contains only its actual immutable posted lines. Source workflow links resolve the actual document kind; dated corrections link to their original entry."
      />
      <section className="panel">
        <h2>Actual posted lines</h2>
        <p>
          {d.total} lines · Page {d.page} of {d.pages}. Complete entry totals
          remain above.
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Actual posted source lines"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Line / account</th>
                <th scope="col">Description</th>
                <th scope="col">Project / party</th>
                <th scope="col">Debit (PKR)</th>
                <th scope="col">Credit (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.sequence} ·{" "}
                    <Link
                      href={
                        "/finance/reports/general-ledger?" +
                        new URLSearchParams({
                          accountId: l.accountId,
                          from: d.entry.postingDate,
                          to: d.entry.postingDate,
                        })
                      }
                    >
                      {l.code} · {l.accountName}
                    </Link>
                    {l.accountActive ? "" : " (archived)"}
                  </td>
                  <td>{l.description}</td>
                  <td>
                    {l.projectName ?? "Company unassigned"}
                    <p>{l.partyName ?? "No party dimension"}</p>
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
        <div className="form-actions">
          {d.page > 1 && (
            <Link href={"?page=" + (d.page - 1)}>Previous posted lines</Link>
          )}
          {d.page < d.pages && (
            <Link href={"?page=" + (d.page + 1)}>Next posted lines</Link>
          )}
        </div>
      </section>
    </section>
  );
}
