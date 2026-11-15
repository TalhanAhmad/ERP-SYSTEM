import Link from "next/link";
import { workDate } from "@/lib/dates";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { cashFlow } from "@/modules/finance/reports/cash-flow/service";
import { cashFlowQuerySchema } from "@/modules/finance/reports/cash-flow/schemas";
import {
  ReportMetadataPanel,
  FinancialSourceLink,
} from "@/modules/finance/components/report-primitives";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function CashFlow({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams,
    today = workDate(),
    input = {
      ...raw,
      from: raw.from ?? today.slice(0, 7) + "-01",
      to: raw.to ?? today,
    },
    p = cashFlowQuerySchema.safeParse(input),
    d = await financePageData((a) =>
      p.success ? cashFlow(a, p.data) : Promise.resolve(null),
    );
  const href = (page: number) =>
    "?" +
    new URLSearchParams({
      from: input.from,
      to: input.to,
      q: raw.q ?? "",
      page: String(page),
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Direct cash flow</h1>
      <section className="panel">
        <form method="get" className="form-grid">
          <label>
            Posting start date
            <input
              name="from"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.from}
              required
            />
          </label>
          <label>
            Posting end date
            <input
              name="to"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.to}
              required
            />
          </label>
          <label>
            Filter displayed sources
            <input name="q" defaultValue={raw.q ?? ""} maxLength={100} />
          </label>
          <button>Show cash flow</button>
        </form>
        {!p.success && (
          <p role="alert" className="error">
            Check the report dates and filters.
          </p>
        )}
      </section>
      {d && (
        <>
          <ReportMetadataPanel
            metadata={d.metadata}
            sourceNote="Actual PKR cash controls include archived accounts and designated cash equivalents. Reviewed components follow posted cash amounts; noncash journals do not create cash flows."
          />
          <section className="panel" aria-label="Complete company cash flow">
            <h2>
              {d.classificationReady
                ? "Cash classifications tie to posted cash"
                : "Cash classification review required"}
            </h2>
            <p>
              {d.unclassifiedCount} unclassified cash sources. Search and pages
              affect displayed sources only.
            </p>
            <dl>
              {(
                [
                  ["openingBalance", "Opening cash"],
                  ["closingBalance", "Closing cash"],
                  ["externalNet", "External cash change"],
                  ["internalNet", "Internal transfer net (excluded)"],
                  ["unclassifiedNet", "Unclassified cash change"],
                  ["difference", "Reconciliation difference"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    <MoneyCell value={d[key]} />
                  </dd>
                </div>
              ))}
            </dl>
            <p>
              Opening cash plus classified external change must equal closing
              cash. A zero difference alone does not clear unreviewed transfers.
              Final export also requires the other book and reconciliation
              checks.
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Cash flow categories"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Inflows (PKR)</th>
                    <th scope="col">Outflows (PKR)</th>
                    <th scope="col">Net (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.categories.map((c) => (
                    <tr key={c.category}>
                      <th scope="row">{c.category.toLowerCase()}</th>
                      <td>
                        <MoneyCell value={c.inflows} />
                      </td>
                      <td>
                        <MoneyCell value={c.outflows} />
                      </td>
                      <td>
                        <MoneyCell value={c.net} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Posted cash sources</h2>
            <p>
              {d.total} sources · Page {d.page} of {d.pages}
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Posted cash sources"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Posting date</th>
                    <th scope="col">Source</th>
                    <th scope="col">Cash change (PKR)</th>
                    <th scope="col">Classification</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.journalId}>
                      <td>{i.postingDate}</td>
                      <td>
                        <FinancialSourceLink
                          type={i.sourceType}
                          id={i.sourceId}
                          reference={i.reference}
                        />
                      </td>
                      <td>
                        <MoneyCell value={i.cashChange} />
                      </td>
                      <td>
                        <Link href={"/finance/cash-flow/" + i.journalId}>
                          {i.classified
                            ? "View reviewed split"
                            : "Review cash split"}
                        </Link>
                        {i.originalJournalId ? " · derived reversal" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              {d.page > 1 && (
                <Link href={href(d.page - 1)}>Previous cash sources</Link>
              )}
              {d.page < d.pages && (
                <Link href={href(d.page + 1)}>Next cash sources</Link>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
