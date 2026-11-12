import Link from "next/link";
import { env } from "@/server/env";
import { periods } from "@/modules/finance/accounting/service";
import { periodQuerySchema } from "@/modules/finance/accounting/schemas";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { PeriodForm } from "@/modules/finance/components/setup-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Periods({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { data, invalid } = await financePageData(async (actor) => {
    const parsed = periodQuerySchema.safeParse(raw);
    return {
      data: await periods(actor, parsed.success ? parsed.data : {}),
      invalid: !parsed.success,
    };
  });
  const href = (page: number) =>
    "/finance/periods?" +
    new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(data.filters).map(([k, v]) => [k, String(v)]),
      ),
      page: String(page),
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Accounting periods</h1>
      <p>
        Dates include both boundaries. No fiscal year is preselected. Period
        close and reopen will use a separate reviewed workflow.
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
      <section className="panel" aria-label="Period register">
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
          <button type="submit">Apply period filters</button>
        </form>
        <p>
          {data.total} matching periods · Page {data.page} of {data.pages}
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Period table"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Start</th>
                <th scope="col">End</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/finance/periods/${p.id}`}>{p.name}</Link>
                  </td>
                  <td>{p.startDate.toISOString().slice(0, 10)}</td>
                  <td>{p.endDate.toISOString().slice(0, 10)}</td>
                  <td>{p.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.items.length && <p>No periods match this view.</p>}
        <nav aria-label="Period pagination" className="form-actions">
          {data.page > 1 && (
            <Link href={href(data.page - 1)}>Previous periods</Link>
          )}
          {data.page < data.pages && (
            <Link href={href(data.page + 1)}>Next periods</Link>
          )}
        </nav>
      </section>
    </section>
  );
}
