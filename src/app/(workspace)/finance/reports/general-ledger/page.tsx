import Link from "next/link";
import { workDate } from "@/lib/dates";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { generalLedger } from "@/modules/finance/reports/service";
import { generalLedgerQuerySchema } from "@/modules/finance/reports/schemas";
import { GeneralLedgerFilters } from "@/modules/finance/components/report-filters";
import {
  BalanceCell,
  ReportMetadataPanel,
  FinancialSourceLink,
} from "@/modules/finance/components/report-primitives";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Ledger({
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
    parsed = generalLedgerQuerySchema.safeParse(input),
    d = await financePageData(async (a) => {
      await financeStatus(a);
      return parsed.success ? generalLedger(a, parsed.data) : null;
    });
  const href = (page: number) =>
    "?" +
    new URLSearchParams({
      from: d!.metadata.from,
      to: d!.metadata.to,
      accountId: d!.account.id,
      page: String(page),
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>General ledger</h1>
      <Link href="/finance/reports/trial-balance">Trial balance</Link>
      <section className="panel">
        <GeneralLedgerFilters
          key={JSON.stringify(input)}
          from={input.from}
          to={input.to}
          accountId={raw.accountId ?? null}
          initial={d ? [d.account] : []}
        />
        {!parsed.success && raw.accountId && (
          <p role="alert" className="error">
            Check the report dates, account and page. No report is shown for
            invalid filters.
          </p>
        )}
        {!raw.accountId && (
          <p>
            Choose a posting account. Control and archived accounts remain
            available for their actual history.
          </p>
        )}
      </section>
      {d && (
        <>
          <ReportMetadataPanel metadata={d.metadata} />
          <section className="panel" aria-label="Ledger account totals">
            <h2>
              {d.account.code} · {d.account.name}
              {d.account.active ? "" : " (archived)"}
            </h2>
            <p>
              {d.account.controlType} · Normal side {d.account.normalSide}.
              Debit balances are DR; credit balances are CR.
            </p>
            <dl>
              <dt>Opening balance before {d.metadata.from}</dt>
              <dd>
                <BalanceCell value={d.openingBalance} />
              </dd>
              <dt>Period debits</dt>
              <dd>
                <MoneyCell value={d.periodDebit} />
              </dd>
              <dt>Period credits</dt>
              <dd>
                <MoneyCell value={d.periodCredit} />
              </dd>
              <dt>Closing balance through {d.metadata.to}</dt>
              <dd>
                <BalanceCell value={d.closingBalance} />
              </dd>
            </dl>
          </section>
          <section className="panel">
            <h2>Posted account movements</h2>
            <p>
              {d.total} posted lines · Page {d.page} of {d.pages}. Running
              balances include all preceding lines, including earlier pages.
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="General ledger movements"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    {[
                      "Posting date",
                      "Source / description",
                      "Project / party",
                      "Debit (PKR)",
                      "Credit (PKR)",
                      "Running balance",
                    ].map((c) => (
                      <th scope="col" key={c}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((l) => (
                    <tr key={l.id}>
                      <td>{l.postingDate}</td>
                      <td>
                        <FinancialSourceLink
                          journalId={l.journalId}
                          type={l.sourceType}
                          id={l.sourceId}
                          reference={l.reference}
                        />
                        <p>{l.description}</p>
                        <small>
                          {l.sourceKind} · {l.sourceAction}
                        </small>
                        {l.isReversal &&
                          l.originalSourceId &&
                          l.originalSourceType && (
                            <p>
                              <Link
                                href={"/finance/posted-sources/" + l.journalId}
                              >
                                View correction and original entry
                              </Link>
                            </p>
                          )}
                      </td>
                      <td>
                        {l.projectName ?? "Company"} / {l.partyName ?? "—"}
                      </td>
                      <td>
                        <MoneyCell value={l.debit} />
                      </td>
                      <td>
                        <MoneyCell value={l.credit} />
                      </td>
                      <td>
                        <BalanceCell value={l.runningBalance} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.total && (
              <p>
                No posted movement in this range. Any opening balance still
                carries to closing.
              </p>
            )}
            <div className="form-actions">
              {d.page > 1 && (
                <Link href={href(d.page - 1)}>Previous ledger page</Link>
              )}
              {d.page < d.pages && (
                <Link href={href(d.page + 1)}>Next ledger page</Link>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
