import { ReportExportLink } from "@/modules/finance/components/report-export-link";
import Link from "next/link";
import { workDate } from "@/lib/dates";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { profitLoss } from "@/modules/finance/reports/statements/service";
import { profitLossQuerySchema } from "@/modules/finance/reports/statements/schemas";
import { StatementReadinessPanel } from "@/modules/finance/components/statement-report-components";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function ProfitLoss({
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
    p = profitLossQuerySchema.safeParse(input),
    d = await financePageData((a) =>
      p.success ? profitLoss(a, p.data) : Promise.resolve(null),
    );
  const href = (page: number, issuePage = d?.readiness.page ?? 1) =>
    "?" +
    new URLSearchParams({
      from: input.from,
      to: input.to,
      q: p.success ? p.data.q : "",
      page: String(page),
      issuePage: String(issuePage),
    });
  const labels = [
    ["revenue", "Earned revenue"],
    ["directCosts", "Direct costs"],
    ["grossProfit", "Gross profit"],
    ["operatingExpenses", "Operating expenses"],
    ["operatingProfit", "Operating profit"],
    ["otherIncome", "Other income"],
    ["otherExpenses", "Other expenses"],
    ["profitBeforeIncomeTax", "Profit before income tax"],
    ["incomeTaxExpense", "Income-tax expense"],
    ["netProfit", "Net profit / (loss)"],
  ] as const;
  return (
    <section>
      <FinanceNavigation />
      <h1>Profit and loss</h1>
      <Link
        href={
          p.success
            ? "/finance/reports/balance-sheet?" +
              new URLSearchParams({ asOf: p.data.to })
            : "/finance/reports/balance-sheet"
        }
      >
        Balance sheet at period end
      </Link>
      <section className="panel">
        <form method="get" className="form-grid">
          <label>
            Posting start date
            <input
              type="date"
              name="from"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.from}
              required
            />
          </label>
          <label>
            Posting end date
            <input
              type="date"
              name="to"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.to}
              required
            />
          </label>
          <label>
            Filter displayed accounts
            <input name="q" defaultValue={raw.q ?? ""} maxLength={100} />
          </label>
          <button type="submit">Show profit and loss</button>
        </form>
        {!p.success && (
          <p className="error" role="alert">
            Check dates, display filters and page. No statement is shown for
            invalid filters.
          </p>
        )}
      </section>
      {d && (
        <>
          <ReportExportLink reportType="PROFIT_LOSS" filters={input} />
          <StatementReadinessPanel
            metadata={d.metadata}
            readiness={d.readiness}
            issueHref={(n) => href(d.page, n)}
            profitLoss
          />
          <section
            className="panel"
            aria-label="Complete company profit and loss"
          >
            <h2>Company result</h2>
            <p>
              Posted accrual results include earned income and incurred unpaid
              costs. Deferred billing, asset/prepayment purchases and funding
              are separate balances. Search and pagination affect displayed
              account rows only.
            </p>
            <dl>
              {labels.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    <MoneyCell value={d.sections[key]} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel">
            <h2>Posted result accounts</h2>
            <p>
              {d.total} matching accounts · Page {d.page} of {d.pages}
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Profit and loss accounts"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Presentation</th>
                    <th scope="col">Debits (PKR)</th>
                    <th scope="col">Credits (PKR)</th>
                    <th scope="col">Statement amount (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link
                          href={
                            "/finance/reports/general-ledger?" +
                            new URLSearchParams({
                              accountId: a.id,
                              from: d.metadata.from,
                              to: d.metadata.to,
                            })
                          }
                        >
                          {a.code} · {a.name}
                        </Link>
                        {a.active ? "" : " (archived)"}
                      </td>
                      <td>
                        {a.statementGroup.replaceAll("_", " ").toLowerCase()}
                        {a.taxMappingId
                          ? " · reviewed mapping version " + a.taxMappingVersion
                          : ""}
                      </td>
                      <td>
                        <MoneyCell value={a.periodDebit} />
                      </td>
                      <td>
                        <MoneyCell value={a.periodCredit} />
                      </td>
                      <td>
                        <MoneyCell value={a.statementAmount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.total && (
              <p>
                No posted result accounts match the display filter. Complete
                company results remain above.
              </p>
            )}
            <div className="form-actions">
              {d.page > 1 && (
                <Link href={href(d.page - 1)}>Previous result accounts</Link>
              )}
              {d.page < d.pages && (
                <Link href={href(d.page + 1)}>Next result accounts</Link>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
