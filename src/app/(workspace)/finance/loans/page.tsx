import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { loans } from "@/modules/finance/funding/loans/service";
import { loanQuerySchema } from "@/modules/finance/funding/loans/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
export const dynamic = "force-dynamic";
export default async function Loans({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    data = await financePageData((a) => {
      const p = loanQuerySchema.safeParse(raw);
      return loans(a, p.success ? p.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Loan register</h1>
      <p>
        Principal and manually accrued interest are derived from posted
        movements. Received and advanced amounts remain separate.
      </p>
      <Link className="button primary" href="/finance/loans/new">
        New loan agreement
      </Link>
      <section className="panel" aria-label="Loan balances">
        <p>
          Loans received: principal{" "}
          <MoneyCell value={data.summary.receivedPrincipal} /> · interest
          payable <MoneyCell value={data.summary.receivedInterest} />
        </p>
        <p>
          Loans advanced: principal{" "}
          <MoneyCell value={data.summary.advancedPrincipal} /> · interest
          receivable <MoneyCell value={data.summary.advancedInterest} />
        </p>
      </section>
      <FinanceRegister
        drawer={false}
        label="Loan"
        columns={[
          "Direction",
          "Counterparty",
          "State",
          "Principal (PKR)",
          "Interest (PKR)",
        ]}
        rows={data.items.map((i) => ({
          id: i.id,
          name: i.number + " · " + i.name,
          href: "/finance/loans/" + i.id,
          endpoint: "/api/v1/finance/loans/" + i.id,
          cells: [
            i.direction,
            i.partyName,
            i.state,
            <MoneyCell key="p" value={i.principal} />,
            <MoneyCell key="i" value={i.interest} />,
          ],
        }))}
        total={data.total}
        page={data.page}
        pages={data.pages}
        href={(page) =>
          "?" + new URLSearchParams({ ...data.filters, page: String(page) })
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search loans
            <input name="q" defaultValue={data.filters.q} />
          </label>
          <label>
            Direction
            <select name="direction" defaultValue={data.filters.direction}>
              {["ALL", "RECEIVED", "ADVANCED"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Active status
            <select name="active" defaultValue={data.filters.active}>
              {["ALL", "ACTIVE", "ARCHIVED"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Balances through date
            <input name="asOf" type="date" defaultValue={data.filters.asOf} />
          </label>
          <button>Filter loans</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
