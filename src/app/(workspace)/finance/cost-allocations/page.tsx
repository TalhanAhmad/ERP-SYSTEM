import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { costAllocations } from "@/modules/finance/projects/costs/service";
import { costQuerySchema } from "@/modules/finance/projects/costs/schemas";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams,
    d = await financePageData((a) => {
      const q = costQuerySchema.safeParse(raw);
      return costAllocations(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Cost allocations</h1>
      <Link href="/finance/cost-allocations/new">New cost allocation</Link>
      <p>
        Allocate actual posted costs to projects or shared company overhead.
      </p>
      <FinanceRegister
        drawer={false}
        label="Cost allocation"
        columns={["Description", "Type", "Date", "Amount (PKR)", "State"]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/cost-allocations/" + i.id,
          endpoint: "/api/v1/finance/cost-allocations/" + i.id,
          cells: [
            i.description,
            i.kind,
            i.postingDate,
            <MoneyCell key="amount" value={i.amount} />,
            i.reversedBy ? "REVERSED" : i.state,
          ],
        }))}
        total={d.total}
        page={d.page}
        pages={d.pages}
        href={(page) =>
          "?" + new URLSearchParams({ ...d.filters, page: String(page) })
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search cost allocations
            <input name="q" defaultValue={d.filters.q} maxLength={100} />
          </label>
          <label>
            State
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "DRAFT", "POSTED", "VOIDED", "REVERSED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter allocations</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
