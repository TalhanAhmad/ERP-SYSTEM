import Link from "next/link";
import { accounts } from "@/modules/finance/accounting/service";
import { accountQuerySchema } from "@/modules/finance/accounting/schemas";
import { accountTypes } from "@/modules/finance/accounting/catalog";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
export const dynamic = "force-dynamic";
export default async function Accounts({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    { data, invalid } = await financePageData(async (actor) => {
      const p = accountQuerySchema.safeParse(raw);
      return {
        data: await accounts(actor, p.success ? p.data : {}),
        invalid: !p.success,
      };
    });
  const href = (page: number) =>
    "/finance/accounts?" +
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
      <p className="eyebrow">FINANCE · PKR</p>
      <h1>Chart of accounts</h1>
      <p>
        Configure account classification before recording financial activity.
        Balances derive from posted journals.
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
      <FinanceRegister
        label="Account"
        columns={[
          "Code / name",
          "Type / normal side",
          "Report group",
          "Control",
          "State",
        ]}
        total={data.total}
        page={data.page}
        pages={data.pages}
        href={href}
        rows={data.items.map((a) => ({
          id: a.id,
          name: a.code + " · " + a.name,
          href: "/finance/accounts/" + a.id,
          endpoint: "/api/v1/finance/accounts/" + a.id,
          cells: [
            a.type +
              " · " +
              a.normalSide +
              (!a.isPosting ? " · group" : "") +
              (a.isContra ? " · contra" : ""),
            a.reportGroup,
            a.controlType + (a.isCashEquivalent ? " · cash equivalent" : ""),
            a.active ? "Active" : "Archived",
          ],
        }))}
      >
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
          <label>
            Rows per page
            <select name="pageSize" defaultValue={data.pageSize}>
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply account filters</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
