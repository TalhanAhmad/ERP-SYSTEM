import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { forecasts } from "@/modules/finance/planning/service";
import { forecastQuerySchema } from "@/modules/finance/planning/schemas";
export const dynamic = "force-dynamic";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    d = await financePageData((a) => {
      const p = forecastQuerySchema.safeParse(q);
      return forecasts(a, p.success ? p.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Cash forecasts</h1>
      <Link href="/finance/forecasts/new">New cash forecast</Link>
      <p>
        Expected receipt/payment dates and likelihood. These plans do not record
        money received, paid or an accounting entry.
      </p>
      <FinanceRegister
        drawer={false}
        label="Cash forecast"
        columns={[
          "Expected date",
          "Direction / likelihood",
          "Expected amount (PKR)",
          "Project",
          "State",
        ]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/forecasts/" + i.id,
          endpoint: "/api/v1/finance/forecasts/" + i.id,
          cells: [
            i.expectedDate,
            i.kind + " · " + i.likelihood,
            <MoneyCell key="amount" value={i.amount} />,
            i.project?.name ?? "Shared company",
            i.state,
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
          {d.filters.projectId && (
            <input type="hidden" name="projectId" value={d.filters.projectId} />
          )}
          <label>
            Search cash forecasts
            <input name="q" maxLength={100} defaultValue={d.filters.q} />
          </label>
          <label>
            From expected date
            <input
              type="date"
              name="from"
              required
              defaultValue={d.filters.from}
            />
          </label>
          <label>
            Through expected date
            <input type="date" name="to" required defaultValue={d.filters.to} />
          </label>
          <label>
            Direction
            <select name="kind" defaultValue={d.filters.kind}>
              {["ALL", "RECEIPT", "PAYMENT"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Forecast state
            <select name="state" defaultValue={d.filters.state}>
              {["ACTIVE", "CANCELLED", "ALL"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter cash forecasts</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
