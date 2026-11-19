import { ReportExportLink } from "@/modules/finance/components/report-export-link";
import Link from "next/link";
import { workDate } from "@/lib/dates";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { balanceSheet } from "@/modules/finance/reports/statements/service";
import { balanceSheetQuerySchema } from "@/modules/finance/reports/statements/schemas";
import { StatementReadinessPanel } from "@/modules/finance/components/statement-report-components";
import { BalanceCell } from "@/modules/finance/components/report-primitives";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function BalanceSheet({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams,
    input = { ...raw, asOf: raw.asOf ?? workDate() },
    p = balanceSheetQuerySchema.safeParse(input),
    d = await financePageData((a) =>
      p.success ? balanceSheet(a, p.data) : Promise.resolve(null),
    );
  const href = (page: number, issuePage = d?.readiness.page ?? 1) =>
    "?" +
    new URLSearchParams({
      asOf: input.asOf,
      q: p.success ? p.data.q : "",
      page: String(page),
      issuePage: String(issuePage),
    });
  const labels = [
    ["currentAssets", "Current assets"],
    ["noncurrentAssets", "Noncurrent assets"],
    ["totalAssets", "Total assets"],
    ["currentLiabilities", "Current liabilities"],
    ["noncurrentLiabilities", "Noncurrent liabilities"],
    ["totalLiabilities", "Total liabilities"],
    ["postedEquity", "Posted equity / retained earnings"],
    ["unclosedProfit", "Unclosed profit / (loss)"],
    ["totalEquity", "Total equity including unclosed result"],
    ["difference", "Balance-sheet difference"],
  ] as const;
  return (
    <section>
      <FinanceNavigation />
      <h1>Balance sheet</h1>
      <Link href="/finance/reports/profit-loss">Profit and loss</Link>
      <section className="panel">
        <form method="get" className="form-grid">
          <label>
            Statement as-of date
            <input
              type="date"
              name="asOf"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.asOf}
              required
            />
          </label>
          <label>
            Filter displayed accounts
            <input name="q" maxLength={100} defaultValue={raw.q ?? ""} />
          </label>
          <button type="submit">Show balance sheet</button>
        </form>
        {!p.success && (
          <p className="error" role="alert">
            Check the cutoff, display filters and page. No statement is shown
            for invalid filters.
          </p>
        )}
      </section>
      {d && (
        <>
          <ReportExportLink reportType="BALANCE_SHEET" filters={input} />
          <StatementReadinessPanel
            metadata={d.metadata}
            readiness={d.readiness}
            issueHref={(n) => href(d.page, n)}
          />
          <section
            className="panel"
            aria-label="Complete company balance sheet"
          >
            <h2>Company position</h2>
            <p>
              All actual posted balances through {d.metadata.to}. Unclosed
              profit is counted once alongside posted equity; closing entries
              already reflected in retained earnings are included in the
              unclosed calculation. Unclosed profit covers results not yet
              transferred by a year close.
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
            <p>
              Assets − liabilities − posted equity − unclosed profit =
              balance-sheet difference. Display filters do not change company
              totals.
            </p>
          </section>
          <section className="panel">
            <h2>Position accounts</h2>
            <p>
              {d.total} matching nonzero accounts · Page {d.page} of {d.pages}
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Balance sheet accounts"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Presentation</th>
                    <th scope="col">Actual GL balance</th>
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
                              from: "0001-01-01",
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
                        {a.presentationChanged
                          ? " · reviewed bank credit presentation"
                          : ""}
                      </td>
                      <td>
                        <BalanceCell value={a.originalBalance} />
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
                No nonzero position accounts match the display filter. Complete
                company totals remain above.
              </p>
            )}
            <div className="form-actions">
              {d.page > 1 && (
                <Link href={href(d.page - 1)}>Previous position accounts</Link>
              )}
              {d.page < d.pages && (
                <Link href={href(d.page + 1)}>Next position accounts</Link>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
