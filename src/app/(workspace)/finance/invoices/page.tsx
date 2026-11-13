import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { invoices } from "@/modules/finance/receivables/service";
import { invoiceQuerySchema } from "@/modules/finance/receivables/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Invoices({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    { data, invalid } = await financePageData(async (actor) => {
      const p = invoiceQuerySchema.safeParse(raw);
      return {
        data: await invoices(actor, p.success ? p.data : {}),
        invalid: !p.success,
      };
    });
  const href = (page: number) =>
    "/finance/invoices?" +
    new URLSearchParams(
      Object.entries({ ...data.filters, page })
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>Invoices</h1>
      <p>Draft, review and bill earned or deferred services.</p>
      <Link className="button primary" href="/finance/invoices/new">
        New invoice draft
      </Link>
      {invalid && (
        <p role="alert">
          Invalid filters. Showing the default view.{" "}
          <Link href="/finance/invoices">Clear filters</Link>
        </p>
      )}
      <FinanceRegister
        drawer={false}
        label="Invoice"
        columns={["Invoice", "Posting date", "Client", "State", "Total (PKR)"]}
        rows={data.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/invoices/" + i.id,
          endpoint: "/api/v1/finance/invoices/" + i.id,
          cells: [
            i.postingDate,
            (i.partySnapshot as { name?: string } | null)?.name ?? i.party.name,
            i.state,
            <MoneyCell key="total" value={i.totalAmount} />,
          ],
        }))}
        total={data.total}
        page={data.page}
        pages={data.pages}
        href={href}
        totals={
          <p>
            Filtered document total:{" "}
            <MoneyCell value={data.totals.totalAmount} />. Includes the selected
            document states.
          </p>
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search invoices
            <input name="q" defaultValue={data.filters.q} />
          </label>
          <label>
            Invoice state
            <select name="state" defaultValue={data.filters.state}>
              {["ALL", "DRAFT", "POSTED", "VOIDED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            From posting date
            <input name="from" type="date" defaultValue={data.filters.from} />
          </label>
          <label>
            To posting date
            <input name="to" type="date" defaultValue={data.filters.to} />
          </label>
          <label>
            Invoice order
            <select name="sort" defaultValue={data.filters.sort}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="number">Number</option>
            </select>
          </label>
          <button type="submit">Apply invoice filters</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
