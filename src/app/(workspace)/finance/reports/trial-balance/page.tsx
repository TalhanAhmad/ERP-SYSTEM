import Link from "next/link";
import { workDate } from "@/lib/dates";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { trialBalance } from "@/modules/finance/reports/service";
import { trialBalanceQuerySchema } from "@/modules/finance/reports/schemas";
import { ReportMetadataPanel } from "@/modules/finance/components/report-primitives";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Trial({
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
    parsed = trialBalanceQuerySchema.safeParse(input),
    d = await financePageData(async (a) => {
      await financeStatus(a);
      return parsed.success ? trialBalance(a, parsed.data) : null;
    });
  const href = (page: number) =>
    "?" +
    new URLSearchParams({
      ...(parsed.success ? parsed.data : {}),
      from: input.from,
      to: input.to,
      page: String(page),
    } as Record<string, string>);
  return (
    <section>
      <FinanceNavigation />
      <h1>Trial balance</h1>
      <Link href="/finance/reports/general-ledger">General ledger</Link>
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
            Filter displayed accounts
            <input name="q" maxLength={100} defaultValue={raw.q ?? ""} />
          </label>
          <label htmlFor="trial-zero">Show zero accounts</label>
          <select
            id="trial-zero"
            name="includeZero"
            defaultValue={raw.includeZero ?? "NO"}
          >
            <option value="NO">
              Only accounts with opening or period activity
            </option>
            <option value="YES">All posting accounts</option>
          </select>
          <button type="submit">Show trial balance</button>
        </form>
        {!parsed.success && (
          <p role="alert" className="error">
            Check dates, display filter and page. No report is shown for invalid
            filters.
          </p>
        )}
      </section>
      {d && (
        <>
          <ReportMetadataPanel metadata={d.metadata} />
          <section
            className="panel"
            aria-label="Complete company trial balance"
          >
            <h2>Complete company totals</h2>
            <p>
              These totals include all {d.companyTotals.accountCount} PKR
              posting accounts. Search, zero-account display and pagination
              affect the displayed rows only.
            </p>
            <dl>
              {[
                ["Opening debits", d.companyTotals.openingDebit],
                ["Opening credits", d.companyTotals.openingCredit],
                ["Period debits", d.companyTotals.periodDebit],
                ["Period credits", d.companyTotals.periodCredit],
                ["Closing debits", d.companyTotals.closingDebit],
                ["Closing credits", d.companyTotals.closingCredit],
                ["Opening difference", d.companyTotals.openingDifference],
                ["Period difference", d.companyTotals.periodDifference],
                ["Closing difference", d.companyTotals.closingDifference],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    <MoneyCell value={v} />
                  </dd>
                </div>
              ))}
            </dl>
            {[
              d.companyTotals.openingDifference,
              d.companyTotals.periodDifference,
              d.companyTotals.closingDifference,
            ].some((v) => v !== "0.00") && (
              <p role="alert" className="error">
                The posted trial balance does not balance. Review accounting
                integrity before issuing a statement.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Account balances</h2>
            <p>
              {d.total} displayed accounts · Page {d.page} of {d.pages}
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Trial balance account rows"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    {[
                      "Account",
                      "Opening debit",
                      "Opening credit",
                      "Period debit",
                      "Period credit",
                      "Closing debit",
                      "Closing credit",
                    ].map((c) => (
                      <th key={c} scope="col">
                        {c === "Account" ? c : c + " (PKR)"}
                      </th>
                    ))}
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
                      {[
                        a.openingDebit,
                        a.openingCredit,
                        a.periodDebit,
                        a.periodCredit,
                        a.closingDebit,
                        a.closingCredit,
                      ].map((v, n) => (
                        <td key={n}>
                          <MoneyCell value={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.total && (
              <p>
                No accounts match the display filter; company totals remain
                complete.
              </p>
            )}
            <div className="form-actions">
              {d.page > 1 && (
                <Link href={href(d.page - 1)}>Previous trial balance page</Link>
              )}
              {d.page < d.pages && (
                <Link href={href(d.page + 1)}>Next trial balance page</Link>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
