import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { cashRegister } from "@/modules/finance/treasury/service";
import { cashQuerySchema } from "@/modules/finance/treasury/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Cash({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    data = await financePageData((a) => {
      const p = cashQuerySchema.safeParse(raw);
      return cashRegister(a, p.success ? p.data : {});
    }),
    href = (page: number) =>
      "?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries({ ...data.filters, page })
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ),
      );
  return (
    <section>
      <FinanceNavigation />
      <h1>Cash register</h1>
      <p>
        Posted bank/cash ledger entries. Balances include all entries for the
        selected accounts and dates; search and transfer visibility change the
        listed rows.
      </p>
      <Link href="/finance/transfers/new" className="button primary">
        Record a transfer
      </Link>
      <form method="get" className="form-grid">
        <label>
          Search cash entries
          <input name="q" defaultValue={data.filters.q} />
        </label>
        {data.filters.cashAccountId && (
          <input
            type="hidden"
            name="cashAccountId"
            value={data.filters.cashAccountId}
          />
        )}
        <label>
          From date
          <input name="from" type="date" defaultValue={data.filters.from} />
        </label>
        <label>
          To date
          <input name="to" type="date" defaultValue={data.filters.to} />
        </label>
        <label>
          Show internal transfers
          <select
            name="includeInternal"
            defaultValue={data.filters.includeInternal}
          >
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </select>
        </label>
        <button>Filter cash register</button>
        <Link href="/finance/cash-register">All cash accounts</Link>
      </form>
      <section className="panel" aria-label="Cash totals">
        <p>
          Opening posted balance <MoneyCell value={data.summary.opening} /> ·
          Ending posted balance <MoneyCell value={data.summary.closing} />
        </p>
        <p>
          Matching external cash in{" "}
          <MoneyCell value={data.summary.externalIn} /> · out{" "}
          <MoneyCell value={data.summary.externalOut} />
        </p>
        <p>
          Matching internal transfer in{" "}
          <MoneyCell value={data.summary.internalIn} /> · out{" "}
          <MoneyCell value={data.summary.internalOut} />
        </p>
        <p>
          Internal transfers are excluded from external totals. This register is
          separate from the classified cash-flow statement.
        </p>
      </section>
      <p>
        {data.total} matching entries · page {data.page} of {data.pages}
      </p>
      <div
        className="table-wrap"
        role="region"
        aria-label="Cash register entries"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              {[
                "Date",
                "Bank/cash",
                "Journal",
                "Description",
                "In",
                "Out",
                "Balance after entry",
                "Movement",
              ].map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => (
              <tr key={i.id}>
                <td>{i.postingDate}</td>
                <td>
                  <Link
                    href={
                      "/finance/cash-register?cashAccountId=" + i.cashAccountId
                    }
                  >
                    {i.cashName}
                  </Link>
                </td>
                <td>
                  {["MOVEMENT", "ASSET_MOVEMENT"].includes(i.sourceType) ? (
                    <Link
                      href={
                        (i.sourceType === "ASSET_MOVEMENT"
                          ? "/finance/asset-movements/"
                          : "/finance/movements/") + i.sourceId
                      }
                    >
                      {i.reference}
                    </Link>
                  ) : (
                    i.reference
                  )}
                </td>
                <td>{i.description}</td>
                <td>
                  <MoneyCell value={i.debit} />
                </td>
                <td>
                  <MoneyCell value={i.credit} />
                </td>
                <td>
                  <MoneyCell value={i.balance} />
                </td>
                <td>{i.internal ? "Internal transfer" : "External"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        {data.page > 1 && (
          <Link href={href(data.page - 1)}>Previous cash entries</Link>
        )}
        {data.page < data.pages && (
          <Link href={href(data.page + 1)}>Next cash entries</Link>
        )}
      </div>
    </section>
  );
}
