import Link from "next/link";
import { accounts } from "@/modules/finance/accounting/service";
import { accountQuerySchema } from "@/modules/finance/accounting/schemas";
import { accountTypes } from "@/modules/finance/accounting/catalog";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Accounts({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { data, invalid } = await financePageData(async (actor) => {
    const parsed = accountQuerySchema.safeParse(raw);
    return {
      data: await accounts(actor, parsed.success ? parsed.data : {}),
      invalid: !parsed.success,
    };
  });
  const href = (page: number) =>
    "/finance/accounts?" +
    new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(data.filters).map(([k, v]) => [k, String(v)]),
      ),
      page: String(page),
    });
  return (
    <section>
      <FinanceNavigation />
      <p className="eyebrow">FINANCE · PKR</p>
      <h1>Chart of accounts</h1>
      <p>
        Configure account classification before recording financial activity.
        Balances will come from posted journals.
      </p>
      {data.canManage && (
        <Link className="button primary" href="/finance/accounts/new">
          New account
        </Link>
      )}
      {invalid && (
        <p role="alert" className="error">
          Invalid filters. Showing the default view.{" "}
          <Link href="/finance/accounts">Clear filters</Link>
        </p>
      )}
      <section className="panel" aria-label="Account register">
        <form method="get" className="form-grid">
          <label>
            Search accounts
            <input name="q" maxLength={100} defaultValue={data.filters.q} />
          </label>
          <label>
            Account state
            <select name="active" defaultValue={data.filters.active}>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
              <option value="ALL">All</option>
            </select>
          </label>
          <label>
            Type filter
            <select name="type" defaultValue={data.filters.type}>
              <option value="ALL">All types</option>
              {accountTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply account filters</button>
        </form>
        <p>
          {data.total} matching accounts · Page {data.page} of {data.pages}
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Account table"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Code / name</th>
                <th scope="col">Type / normal side</th>
                <th scope="col">Report group</th>
                <th scope="col">Control</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/finance/accounts/${a.id}`}>
                      {a.code} · {a.name}
                    </Link>
                  </td>
                  <td>
                    {a.type} · {a.normalSide}
                    {!a.isPosting ? " · group" : ""}
                    {a.isContra ? " · contra" : ""}
                  </td>
                  <td>{a.reportGroup}</td>
                  <td>
                    {a.controlType}
                    {a.isCashEquivalent ? " · cash equivalent" : ""}
                  </td>
                  <td>{a.active ? "Active" : "Archived"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.items.length && (
          <p>
            No accounts match.{" "}
            {data.canManage
              ? "Create the chart after company review."
              : "The Finance Owner manages the chart."}
          </p>
        )}
        <nav aria-label="Account pagination" className="form-actions">
          {data.page > 1 && (
            <Link href={href(data.page - 1)}>Previous accounts</Link>
          )}
          {data.page < data.pages && (
            <Link href={href(data.page + 1)}>Next accounts</Link>
          )}
        </nav>
      </section>
    </section>
  );
}
