import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { assets } from "@/modules/finance/assets/service";
import { assetQuerySchema } from "@/modules/finance/assets/schemas";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Assets({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    d = await financePageData((a) => {
      const q = assetQuerySchema.safeParse(raw);
      return assets(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Fixed asset register</h1>
      <p>
        Assets link to posted purchase cost. Registering equipment creates no
        second accounting entry.
      </p>
      <Link className="button primary" href="/finance/assets/new">
        Register purchased asset
      </Link>
      <section className="panel" aria-label="Registered asset totals">
        <p>
          Registered matching cost{" "}
          <MoneyCell value={d.summary.registeredCost} /> · Current cost{" "}
          <MoneyCell value={d.summary.currentCost} /> · Carrying value{" "}
          <MoneyCell value={d.summary.carryingValue} /> · Initial residual value{" "}
          <MoneyCell value={d.summary.residualValue} /> · Accumulated
          depreciation <MoneyCell value={d.summary.accumulatedDepreciation} />
        </p>
        <p>Voided registration history contributes no active allocation.</p>
      </section>
      <FinanceRegister
        drawer={false}
        label="Asset"
        columns={[
          "Asset",
          "Description",
          "Location / custodian",
          "State",
          "Current cost (PKR)",
          "Carrying value (PKR)",
          "Convention",
        ]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.tag + " · " + i.number,
          href: "/finance/assets/" + i.id,
          endpoint: "/api/v1/finance/assets/" + i.id,
          cells: [
            i.description,
            i.location + " · " + (i.custodian?.displayName ?? "Unassigned"),
            i.state,
            <MoneyCell key="c" value={i.currentCost} />,
            <MoneyCell key="v" value={i.carryingValue} />,
            i.convention,
          ],
        }))}
        total={d.total}
        page={d.page}
        pages={d.pages}
        href={(page) =>
          "?" +
          new URLSearchParams(
            Object.fromEntries(
              Object.entries({ ...d.filters, page: String(page) })
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)]),
            ),
          )
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search assets
            <input name="q" defaultValue={d.filters.q} />
          </label>
          <label>
            Registration state
            <select name="state" defaultValue={d.filters.state}>
              {["REGISTERED", "DISPOSED", "VOIDED", "ALL"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button>Filter assets</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
