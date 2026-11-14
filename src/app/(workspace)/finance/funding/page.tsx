import { fundingBalances } from "@/modules/finance/funding/service";
import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { movements } from "@/modules/finance/treasury/service";
import { movementQuerySchema } from "@/modules/finance/treasury/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Transfers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { contributor, balancePage, ...raw } = await searchParams,
    data = await financePageData((a) => {
      const p = movementQuerySchema.safeParse({ ...raw, family: "FUNDING" });
      return movements(a, p.success ? p.data : { family: "FUNDING" });
    });
  const balances = await financePageData((a) =>
    fundingBalances(a, {
      q: typeof contributor === "string" ? contributor : "",
      page: typeof balancePage === "string" ? balancePage : 1,
    }),
  );
  return (
    <section>
      <FinanceNavigation />
      <h1>Founder funding</h1>
      <p>
        Capital, approved returns/distributions and personal company outlays are
        recorded separately.
      </p>
      <Link className="button primary" href="/finance/funding/new">
        New funding draft
      </Link>
      <section className="panel">
        <h2>Posted contributor balances</h2>
        <form method="get">
          <label>
            Search contributor
            <input name="contributor" defaultValue={balances.filters.q} />
          </label>
          <button>Find contributor</button>
        </form>
        <p>
          {balances.total} contributors · page {balances.page} of{" "}
          {balances.pages}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Contributor</th>
                <th>Capital contributions</th>
                <th>Capital returned</th>
                <th>Capital balance</th>
                <th>Distributions</th>
                <th>Personal company costs</th>
                <th>Reimbursed</th>
                <th>Founder payable</th>
              </tr>
            </thead>
            <tbody>
              {balances.items.map((b) => (
                <tr key={b.partyId}>
                  <td>{b.name}</td>
                  <td>
                    <MoneyCell value={b.contributions} />
                  </td>
                  <td>
                    <MoneyCell value={b.returns} />
                  </td>
                  <td>
                    <MoneyCell value={b.capital} />
                  </td>
                  <td>
                    <MoneyCell value={b.distributions} />
                  </td>
                  <td>
                    <MoneyCell value={b.outlays} />
                  </td>
                  <td>
                    <MoneyCell value={b.reimbursed} />
                  </td>
                  <td>
                    <MoneyCell value={b.founderPayable} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-actions">
          {balances.page > 1 && (
            <Link
              href={
                "?" +
                new URLSearchParams({
                  contributor: balances.filters.q,
                  balancePage: String(balances.page - 1),
                })
              }
            >
              Previous contributors
            </Link>
          )}
          {balances.page < balances.pages && (
            <Link
              href={
                "?" +
                new URLSearchParams({
                  contributor: balances.filters.q,
                  balancePage: String(balances.page + 1),
                })
              }
            >
              Next contributors
            </Link>
          )}
        </div>
        <p>
          Posted balances; loan principal is recorded separately in the loan
          register.
        </p>
      </section>
      <FinanceRegister
        drawer={false}
        label="Funding"
        columns={["Movement", "Posting date", "State", "Amount (PKR)"]}
        rows={data.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/movements/" + i.id,
          endpoint: "/api/v1/finance/movements/" + i.id,
          cells: [
            i.postingDate,
            i.state,
            <MoneyCell key="amount" value={i.amount} />,
          ],
        }))}
        total={data.total}
        page={data.page}
        pages={data.pages}
        href={(page) =>
          "?" + new URLSearchParams({ ...data.filters, page: String(page) })
        }
        totals={
          <p>
            Filtered document total: <MoneyCell value={data.totalAmount} />.
            Includes selected source states.
          </p>
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search funding movements
            <input name="q" defaultValue={data.filters.q} />
          </label>
          <label>
            Movement state
            <select name="state" defaultValue={data.filters.state}>
              {["ALL", "DRAFT", "POSTED", "REVERSED", "VOIDED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            From posting date
            <input name="from" type="date" defaultValue={data.filters.from} />
          </label>
          <label>
            To posting date
            <input name="to" type="date" defaultValue={data.filters.to} />
          </label>
          <button>Filter funding</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
