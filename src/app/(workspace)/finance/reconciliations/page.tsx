import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { reconciliations } from "@/modules/finance/treasury/reconciliation/service";
import { reconciliationQuerySchema } from "@/modules/finance/treasury/reconciliation/schemas";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams,
    d = await financePageData((a) => {
      const q = reconciliationQuerySchema.safeParse(raw);
      return reconciliations(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Bank reconciliations</h1>
      <Link href="/finance/reconciliations/new">Review a bank statement</Link>
      <p>
        Review bank-to-GL equations, documented outstanding items and retained
        issued snapshots. Reconciliation posts no cash.
      </p>
      <FinanceRegister
        drawer={false}
        label="Reconciliation"
        columns={[
          "Bank",
          "Bank / cutoff",
          "Closing bank balance (PKR)",
          "State",
        ]}
        rows={d.items.map((b) => ({
          id: b.id,
          name: b.number,
          href: "/finance/reconciliations/" + b.id,
          endpoint: "/api/v1/finance/reconciliations/" + b.id,
          cells: [
            b.cashAccount.name,
            b.startDate + " — " + b.cutoffDate,
            <MoneyCell key="closing" value={b.closingBalance} />,
            b.state,
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
          {d.filters.cashAccountId && (
            <input
              type="hidden"
              name="cashAccountId"
              value={d.filters.cashAccountId}
            />
          )}
          <label>
            Search reconciliations
            <input name="q" maxLength={100} defaultValue={d.filters.q} />
          </label>
          <label>
            Review state
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "DRAFT", "FINALIZED", "VOIDED", "REOPENED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter reconciliations</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
