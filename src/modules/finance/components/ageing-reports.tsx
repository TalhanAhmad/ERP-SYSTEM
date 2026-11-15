import Link from "next/link";
import { workDate } from "@/lib/dates";
import { financePageData } from "../accounting/page-data";
import {
  ageing,
  ageingHistory,
  type AgeingSide,
} from "../reports/ageing/service";
import { ageingQuerySchema, ageingBuckets } from "../reports/ageing/schemas";
import { FinanceNavigation } from "./setup-navigation";
import { MoneyCell } from "./money-cell";
import { ReportMetadataPanel, FinancialSourceLink } from "./report-primitives";
type Query = Promise<Record<string, string | undefined>>;
export const ageingBucketLabels: Record<string, string> = {
  ALL: "All buckets",
  NOT_DUE: "Not due / due today",
  DAYS_1_30: "1–30 days",
  DAYS_31_60: "31–60 days",
  DAYS_61_90: "61–90 days",
  OVER_90: "Over 90 days",
};
export async function AgeingReportPage({
  side,
  searchParams,
}: {
  side: AgeingSide;
  searchParams: Query;
}) {
  const raw = await searchParams,
    input = { ...raw, asOf: raw.asOf ?? workDate() },
    p = ageingQuerySchema.safeParse(input),
    d = await financePageData((a) =>
      p.success ? ageing(a, side, p.data) : Promise.resolve(null),
    ),
    name = side === "AR" ? "receivables" : "payables",
    resource = side === "AR" ? "invoices" : "bills",
    title = side === "AR" ? "Receivables" : "Payables";
  const href = (page: number, issuePage = d?.reconciliation.page ?? 1) =>
    "?" +
    new URLSearchParams({
      asOf: input.asOf,
      q: raw.q ?? "",
      bucket: p.success ? p.data.bucket : "ALL",
      includeSettled: p.success ? p.data.includeSettled : "NO",
      page: String(page),
      issuePage: String(issuePage),
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>{title} ageing</h1>
      <section className="panel">
        <form method="get" className="form-grid">
          <label>
            As of (Pakistan date)
            <input
              name="asOf"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.asOf}
              required
            />
          </label>
          <label>
            Filter displayed documents
            <input name="q" defaultValue={raw.q ?? ""} maxLength={100} />
          </label>
          <label>
            Displayed ageing bucket
            <select
              name="bucket"
              defaultValue={p.success ? p.data.bucket : "ALL"}
            >
              {ageingBuckets.map((v) => (
                <option key={v} value={v}>
                  {ageingBucketLabels[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Include documents settled by cutoff
            <select
              name="includeSettled"
              defaultValue={p.success ? p.data.includeSettled : "NO"}
            >
              <option value="NO">Open documents only</option>
              <option value="YES">Include settled documents</option>
            </select>
          </label>
          <button>Show {name} ageing</button>
        </form>
        {!p.success && (
          <p role="alert" className="error">
            Check cutoff, display filters and page numbers.
          </p>
        )}
      </section>
      {d && (
        <>
          <ReportMetadataPanel
            metadata={d.metadata}
            sourceNote="Balances reconstruct actual dated subledger events at the inclusive cutoff. Later payments, credits, releases and reversals do not change earlier amounts. Due today is not overdue."
          />
          <section
            className="panel"
            aria-label="Complete company ageing totals"
          >
            <h2>Company {name} at cutoff</h2>
            <p>
              {d.totals.openDocumentCount} open documents. Search, bucket and
              page affect displayed documents only.
            </p>
            <dl>
              {(
                [
                  ["openAmount", "Total open"],
                  ["notDue", "Not due / due today"],
                  ["days1To30", "1–30 days past due"],
                  ["days31To60", "31–60 days past due"],
                  ["days61To90", "61–90 days past due"],
                  ["over90", "Over 90 days past due"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    <MoneyCell value={d.totals[key]} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section
            className="panel"
            aria-label="Subledger control reconciliation"
          >
            <h2>
              {d.reconciliation.ready
                ? "Subledger and control accounts agree"
                : "Subledger review required"}
            </h2>
            <p>
              All company {name} controls are checked, including archived
              history and accounts outside the display filter.
            </p>
            <dl>
              <div>
                <dt>Subledger total</dt>
                <dd>
                  <MoneyCell value={d.reconciliation.subledgerTotal} />
                </dd>
              </div>
              <div>
                <dt>Posted control total</dt>
                <dd>
                  <MoneyCell value={d.reconciliation.controlTotal} />
                </dd>
              </div>
              <div>
                <dt>Control difference</dt>
                <dd>
                  <MoneyCell value={d.reconciliation.difference} />
                </dd>
              </div>
            </dl>
            <p>
              {d.reconciliation.issueCount} account issues ·{" "}
              {d.reconciliation.negativeDocumentCount} negative document
              balances. A zero grand difference alone does not clear offsetting
              account differences.
            </p>
            <p className="preline">
              Dated event proof {String(d.metadata.filters.subledgerDigest)}
            </p>
            {!!d.reconciliation.issueCount && (
              <>
                <div
                  className="table-wrap"
                  role="region"
                  aria-label="Ageing control issues"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Control account</th>
                        <th scope="col">Subledger (PKR)</th>
                        <th scope="col">GL (PKR)</th>
                        <th scope="col">Difference (PKR)</th>
                        <th scope="col">Negative documents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.reconciliation.issues.map((i) => (
                        <tr key={i.accountId}>
                          <td>
                            <Link
                              href={
                                "/finance/reports/general-ledger?" +
                                new URLSearchParams({
                                  accountId: i.accountId,
                                  from: "0001-01-01",
                                  to: input.asOf,
                                })
                              }
                            >
                              {i.code} · {i.name}
                            </Link>
                          </td>
                          <td>
                            <MoneyCell value={i.subledgerBalance} />
                          </td>
                          <td>
                            <MoneyCell value={i.controlBalance} />
                          </td>
                          <td>
                            <MoneyCell value={i.difference} />
                          </td>
                          <td>{i.negativeDocuments}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Issue page {d.reconciliation.page} of {d.reconciliation.pages}
                </p>
                <div className="form-actions">
                  {d.reconciliation.page > 1 && (
                    <Link href={href(d.page, d.reconciliation.page - 1)}>
                      Previous control issues
                    </Link>
                  )}
                  {d.reconciliation.page < d.reconciliation.pages && (
                    <Link href={href(d.page, d.reconciliation.page + 1)}>
                      Next control issues
                    </Link>
                  )}
                </div>
              </>
            )}
          </section>
          <section className="panel">
            <h2>Documents at cutoff</h2>
            <p>
              {d.total} matching documents · Page {d.page} of {d.pages}
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Historical ageing documents"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Document / party</th>
                    <th scope="col">Due date</th>
                    <th scope="col">Ageing</th>
                    <th scope="col">Original (PKR)</th>
                    <th scope="col">Open at cutoff (PKR)</th>
                    <th scope="col">Dated events</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={"/finance/" + resource + "/" + i.id}>
                          {i.number}
                        </Link>
                        <p>
                          {i.reference} · {i.partyName}
                        </p>
                        <p>
                          {i.accountCode}
                          {i.accountActive ? "" : " (archived)"}
                        </p>
                      </td>
                      <td>{i.dueDate}</td>
                      <td>
                        {ageingBucketLabels[i.bucket]} · {i.daysPastDue} days
                        past due
                      </td>
                      <td>
                        <MoneyCell value={i.originalAmount} />
                      </td>
                      <td>
                        <MoneyCell value={i.openAmount} />
                      </td>
                      <td>
                        <Link
                          href={
                            "/finance/reports/" +
                            name +
                            "-ageing/" +
                            i.id +
                            "?" +
                            new URLSearchParams({ asOf: input.asOf })
                          }
                        >
                          View dated events
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.total && (
              <p>
                No documents match this display. Complete company totals remain
                above.
              </p>
            )}
            <div className="form-actions">
              {d.page > 1 && (
                <Link href={href(d.page - 1)}>Previous aged documents</Link>
              )}
              {d.page < d.pages && (
                <Link href={href(d.page + 1)}>Next aged documents</Link>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
export async function AgeingHistoryPage({
  side,
  params,
  searchParams,
}: {
  side: AgeingSide;
  params: Promise<{ id: string }>;
  searchParams: Query;
}) {
  const { id } = await params,
    raw = await searchParams,
    input = { ...raw, asOf: raw.asOf ?? workDate(), documentId: id },
    d = await financePageData((a) => ageingHistory(a, side, input)),
    resource = side === "AR" ? "invoices" : "bills",
    name = side === "AR" ? "receivables" : "payables";
  const href = (page: number) =>
    "?" + new URLSearchParams({ asOf: input.asOf, page: String(page) });
  return (
    <section>
      <FinanceNavigation />
      <h1>Dated {name} events</h1>
      <section className="panel">
        <h2>{d.document.number}</h2>
        <p>
          Due {d.document.dueDate} · Open at {input.asOf}:{" "}
          <MoneyCell value={d.document.openAmount} />
        </p>
        <p>
          Only events effective by the selected cutoff are included. Running
          balances include earlier event pages.
        </p>
        <Link href={"/finance/" + resource + "/" + id}>
          Open current source document
        </Link>
        <form method="get">
          <label>
            As of (Pakistan date)
            <input
              name="asOf"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.asOf}
              required
            />
          </label>
          <button>Show dated events</button>
        </form>
      </section>
      <ReportMetadataPanel
        metadata={d.metadata}
        sourceNote="Running subledger amounts include actual dated settlements, credit corrections and their opposites through this cutoff."
      />
      <section className="panel">
        <h2>Historical event ledger</h2>
        <p>
          {d.total} events · Page {d.page} of {d.pages}
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Dated subledger events"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Effective date</th>
                <th scope="col">Source</th>
                <th scope="col">Event</th>
                <th scope="col">Change (PKR)</th>
                <th scope="col">Running open (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.effectiveDate}</td>
                  <td>
                    <FinancialSourceLink
                      type={i.sourceType}
                      id={i.sourceId}
                      reference={i.reference}
                    />
                  </td>
                  <td>{i.kind.replaceAll("_", " ").toLowerCase()}</td>
                  <td>
                    <MoneyCell value={i.amount} />
                  </td>
                  <td>
                    <MoneyCell value={i.runningBalance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-actions">
          {d.page > 1 && (
            <Link href={href(d.page - 1)}>Previous dated events</Link>
          )}
          {d.page < d.pages && (
            <Link href={href(d.page + 1)}>Next dated events</Link>
          )}
        </div>
      </section>
      <Link
        href={
          "/finance/reports/" +
          name +
          "-ageing?" +
          new URLSearchParams({ asOf: input.asOf })
        }
      >
        Back to {name} ageing
      </Link>
    </section>
  );
}
