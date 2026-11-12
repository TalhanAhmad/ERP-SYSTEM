import Link from "next/link";
import { env } from "@/server/env";
import { periods } from "@/modules/finance/accounting/service";
import { periodQuerySchema } from "@/modules/finance/accounting/schemas";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { PeriodForm } from "@/modules/finance/components/setup-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
export const dynamic = "force-dynamic";
export default async function Periods({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    { data, invalid } = await financePageData(async (actor) => {
      const p = periodQuerySchema.safeParse(raw);
      return {
        data: await periods(actor, p.success ? p.data : {}),
        invalid: !p.success,
      };
    });
  const href = (page: number) =>
    "/finance/periods?" +
    new URLSearchParams(
      Object.fromEntries(
        Object.entries({ ...data.filters, page }).map(([k, v]) => [
          k,
          String(v),
        ]),
      ),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>Accounting periods</h1>
      <p>
        Both date boundaries are inclusive. Choose the actual reporting dates.
        Period close and reopen use a separate reviewed workflow.
      </p>
      {invalid && (
        <p role="alert" className="error">
          Invalid filters. Showing the default view.{" "}
          <Link href="/finance/periods">Clear filters</Link>
        </p>
      )}
      {data.canManage && (
        <section className="panel" aria-label="Create accounting period">
          <h2>Create open period</h2>
          <PeriodForm hosted={env.AUTH_PROVIDER === "supabase"} />
        </section>
      )}
      <FinanceRegister
        label="Period"
        columns={["Period", "Start", "End", "State"]}
        total={data.total}
        page={data.page}
        pages={data.pages}
        href={href}
        rows={data.items.map((p) => ({
          id: p.id,
          name: p.name,
          href: "/finance/periods/" + p.id,
          endpoint: "/api/v1/finance/periods/" + p.id,
          cells: [
            p.startDate.toISOString().slice(0, 10),
            p.endDate.toISOString().slice(0, 10),
            p.state,
          ],
        }))}
      >
        <form method="get" className="form-grid">
          <label>
            Search periods
            <input name="q" maxLength={100} defaultValue={data.filters.q} />
          </label>
          <label>
            Period state
            <select name="state" defaultValue={data.filters.state}>
              {["ALL", "OPEN", "CLOSED", "VOID"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Rows per page
            <select name="pageSize" defaultValue={data.pageSize}>
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply period filters</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
