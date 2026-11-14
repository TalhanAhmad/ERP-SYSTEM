import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { investmentLots } from "@/modules/finance/investments/service";
import { lotQuerySchema } from "@/modules/finance/investments/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Lots({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params,
    raw = await searchParams,
    d = await financePageData((a) => {
      const q = lotQuerySchema.safeParse(raw);
      return investmentLots(a, id, q.success ? q.data : {});
    }),
    href = (page: number) =>
      "?" + new URLSearchParams({ ...d.filters, page: String(page) });
  return (
    <section>
      <FinanceNavigation />
      <h1>Acquisition lots · {d.holding.name}</h1>
      <Link href={"/finance/investments/" + id}>
        Holding policy and balances
      </Link>
      <form method="get" className="form-grid">
        <label>
          Search lot source
          <input name="q" defaultValue={d.filters.q} />
        </label>
        <label>
          Balances through date
          <input name="asOf" type="date" defaultValue={d.filters.asOf} />
        </label>
        <button>Filter lots</button>
      </form>
      <p>
        {d.total} lots · page {d.page} of {d.pages}. Fully corrected lots retain
        their original acquisition history.
      </p>
      <div
        className="table-wrap"
        role="region"
        aria-label="Acquisition lot register"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              {[
                "Source",
                "Acquired",
                "Original purchase cost",
                "Purchase units",
                "Remaining cost",
                "Carrying value",
                "Remaining units",
              ].map((v) => (
                <th scope="col" key={v}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.items.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={"/finance/movements/" + l.movementId}>
                    {l.number}
                  </Link>
                </td>
                <td>{l.acquisitionDate}</td>
                <td>
                  <MoneyCell value={l.cost} />
                </td>
                <td>{l.units ?? "Amount based"}</td>
                <td>
                  <MoneyCell value={l.remainingCost} />
                </td>
                <td>
                  <MoneyCell value={l.carryingValue} />
                </td>
                <td>{l.remainingUnits ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        {d.page > 1 && <Link href={href(d.page - 1)}>Previous lots</Link>}
        {d.page < d.pages && <Link href={href(d.page + 1)}>Next lots</Link>}
      </div>
    </section>
  );
}
