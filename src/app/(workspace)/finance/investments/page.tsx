import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { holdings } from "@/modules/finance/investments/service";
import { holdingQuerySchema } from "@/modules/finance/investments/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Investments({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    d = await financePageData((a) => {
      const q = holdingQuerySchema.safeParse(raw);
      return holdings(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Investment holdings</h1>
      <p>
        Company-owned holdings with reviewed policy, original cost and carrying
        value. Pending policies are flagged and cannot post.
      </p>
      <Link className="button primary" href="/finance/investments/new">
        New investment holding
      </Link>
      <section className="panel" aria-label="Investment totals">
        <p>
          Remaining original cost <MoneyCell value={d.summary.originalCost} /> ·
          Carrying value <MoneyCell value={d.summary.carryingValue} />
        </p>
        <p>
          Bookkeeping values only; no automatic prices or inferred compliance.
        </p>
      </section>
      <FinanceRegister
        drawer={false}
        label="Holding"
        columns={[
          "Issuer",
          "Policy",
          "Classification",
          "Units",
          "Original cost (PKR)",
          "Carrying value (PKR)",
        ]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number + " · " + i.name,
          href: "/finance/investments/" + i.id,
          endpoint: "/api/v1/finance/holdings/" + i.id,
          cells: [
            i.partyName,
            i.policyStatus + " · " + i.measurementMode,
            i.classification,
            i.units ?? "Amount based",
            <MoneyCell key="c" value={i.originalCost} />,
            <MoneyCell key="v" value={i.carryingValue} />,
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
            Search holdings
            <input name="q" defaultValue={d.filters.q} />
          </label>
          <label>
            Policy status
            <select name="policyStatus" defaultValue={d.filters.policyStatus}>
              {["ALL", "PENDING", "REVIEWED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Classification
            <select
              name="classification"
              defaultValue={d.filters.classification}
            >
              {["ALL", "CURRENT", "NONCURRENT"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Active status
            <select name="active" defaultValue={d.filters.active}>
              {["ALL", "ACTIVE", "ARCHIVED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Balances through date
            <input type="date" name="asOf" defaultValue={d.filters.asOf} />
          </label>
          <button>Filter holdings</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
