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
  const raw = await searchParams,
    data = await financePageData((a) => {
      const p = movementQuerySchema.safeParse({ ...raw, kind: "TRANSFER" });
      return movements(a, p.success ? p.data : { kind: "TRANSFER" });
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Cash transfers</h1>
      <p>
        Both bank/cash legs are recorded together. Internal transfers are
        separate from external cash movements.
      </p>
      <Link className="button primary" href="/finance/transfers/new">
        New transfer draft
      </Link>
      <FinanceRegister
        drawer={false}
        label="Transfer"
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
            Search transfers
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
          <button>Filter transfers</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
