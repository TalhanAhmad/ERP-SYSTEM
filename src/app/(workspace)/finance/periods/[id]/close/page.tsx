import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { periodDetail } from "@/modules/finance/accounting/service";
import {
  closePreview,
  closeHistory,
  closeIssues,
} from "@/modules/finance/closing/service";
import {
  PeriodCloseForm,
  CloseIssueCreateForm,
  CloseIssueResolveForm,
} from "@/modules/finance/components/closing-forms";
import { CloseChecklistPanel } from "@/modules/finance/components/close-checklist";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Closing({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData(async (a) => {
      const period = await periodDetail(a, id);
      const [preview, history, issues] = await Promise.all([
        period.item.state === "OPEN" ? closePreview(a, id) : null,
        closeHistory(a, id, { page: q.historyPage ?? 1 }),
        closeIssues(a, id, { page: q.issuePage ?? 1 }),
      ]);
      return { period, ...{ preview, history, issues } };
    }),
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>Period closing review</h1>
      <p>
        <Link href={`/finance/periods/${id}`}>{d.period.item.name}</Link> ·{" "}
        {d.period.item.state}
      </p>
      {d.preview && (
        <>
          <CloseChecklistPanel value={d.preview} />
          {d.preview.canManage ? (
            <section className="panel" aria-label="Owner close confirmation">
              <h2>Owner close confirmation</h2>
              <PeriodCloseForm
                key={d.preview.basisHash}
                value={d.preview}
                hosted={hosted}
              />
            </section>
          ) : (
            <p>Only the Finance Owner can close or reopen periods.</p>
          )}
        </>
      )}
      <section className="panel">
        <h2>Retained close history</h2>
        <p>
          Page {d.history.page} of {d.history.pages} · {d.history.total} closes
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Retained period closes"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Close</th>
                <th scope="col">State</th>
                <th scope="col">Closed</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {d.history.items.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <Link href={`/finance/periods/${id}/closes/${c.id}`}>
                      Close {c.sequence}
                    </Link>
                  </th>
                  <td>{c.state.toLowerCase()}</td>
                  <td>{c.closedAt}</td>
                  <td>{c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.history.items.length && <p>No period close has been issued.</p>}
        {d.history.page > 1 && (
          <Link
            href={`?historyPage=${d.history.page - 1}&issuePage=${d.issues.page}`}
          >
            Previous closes
          </Link>
        )}
        {d.history.page < d.history.pages && (
          <Link
            href={`?historyPage=${d.history.page + 1}&issuePage=${d.issues.page}`}
          >
            Next closes
          </Link>
        )}
      </section>
      <section className="panel">
        <h2>Recorded review issues</h2>
        <p>
          Page {d.issues.page} of {d.issues.pages} · {d.issues.total} retained
          issues
        </p>
        {d.issues.items.map((i) => (
          <article className="panel" key={i.id}>
            <h3>{i.description}</h3>
            <p>
              {i.kind.toLowerCase().replaceAll("_", " ")} ·{" "}
              {i.state.toLowerCase()}
            </p>
            <p>{i.evidence}</p>
            {i.resolution && <p>Resolution: {i.resolution}</p>}
            {d.issues.canManage &&
              d.period.item.state === "OPEN" &&
              i.state === "OPEN" && (
                <CloseIssueResolveForm
                  key={i.version}
                  issue={i}
                  hosted={hosted}
                />
              )}
          </article>
        ))}
        {!d.issues.items.length && <p>No review issues have been recorded.</p>}
        {d.issues.page > 1 && (
          <Link
            href={`?historyPage=${d.history.page}&issuePage=${d.issues.page - 1}`}
          >
            Previous issues
          </Link>
        )}
        {d.issues.page < d.issues.pages && (
          <Link
            href={`?historyPage=${d.history.page}&issuePage=${d.issues.page + 1}`}
          >
            Next issues
          </Link>
        )}
      </section>
      {d.period.canManage && d.period.item.state === "OPEN" && (
        <section className="panel">
          <h2>Record a review issue</h2>
          <CloseIssueCreateForm periodId={id} hosted={hosted} />
        </section>
      )}
    </section>
  );
}
