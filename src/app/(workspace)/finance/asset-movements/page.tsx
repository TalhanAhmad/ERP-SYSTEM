import { financePageData } from "@/modules/finance/accounting/page-data";
import { assetMovements } from "@/modules/finance/assets/lifecycle/service";
import { assetMovementQuerySchema } from "@/modules/finance/assets/lifecycle/schemas";
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
      const q = assetMovementQuerySchema.safeParse(raw);
      return assetMovements(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Asset movements</h1>
      <p>
        Open an asset to generate a monthly draft or record a reviewed
        adjustment.
      </p>
      <FinanceRegister
        drawer={false}
        label="Asset movement"
        columns={["Asset", "Type / month", "Date", "Amount (PKR)", "State"]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/asset-movements/" + i.id,
          endpoint: "/api/v1/finance/asset-movements/" + i.id,
          cells: [
            i.asset.tag,
            i.kind + " " + (i.month ?? ""),
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
          {d.filters.assetId && (
            <input type="hidden" name="assetId" value={d.filters.assetId} />
          )}
          <label>
            Search asset movements
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
          <button type="submit">Filter movements</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
