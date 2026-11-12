import Link from "next/link";
import { env } from "@/server/env";
import { journals } from "@/modules/finance/ledger/service";
import { journalQuerySchema } from "@/modules/finance/ledger/schemas";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { JournalBatchVoid } from "@/modules/finance/components/journal-forms";
export const dynamic = "force-dynamic";
export default async function Journals({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { data, invalid } = await financePageData(async (actor) => {
    const parsed = journalQuerySchema.safeParse(raw);
    return {
      data: await journals(actor, parsed.success ? parsed.data : {}),
      invalid: !parsed.success,
    };
  });
  const href = (page: number) =>
    "/finance/journals?" +
    new URLSearchParams(
      Object.fromEntries(
        Object.entries({ ...data.filters, page })
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>Journals</h1>
      <p>
        Create ordinary adjustments, review exact totals and post permanent
        double-entry journals. Corrections use dated reversals.
      </p>
      <Link className="button primary" href="/finance/journals/new">
        New journal draft
      </Link>
      {invalid && (
        <p role="alert">
          Invalid filters. Showing the default view.{" "}
          <Link href="/finance/journals">Clear filters</Link>
        </p>
      )}
      <FinanceRegister
        label="Journal"
        columns={[
          "Reference",
          "Posting date",
          "Description",
          "State",
          "Original debit",
          "Original credit",
        ]}
        total={data.total}
        page={data.page}
        pages={data.pages}
        href={href}
        rows={data.items.map((i) => ({
          id: i.id,
          name: i.reference,
          href: "/finance/journals/" + i.id,
          endpoint: "/api/v1/finance/journals/" + i.id,
          cells: [
            i.postingDate.toISOString().slice(0, 10),
            i.description,
            i.state,
            <MoneyCell key="d" value={i.totals.debit} />,
            <MoneyCell key="c" value={i.totals.credit} />,
          ],
        }))}
        totals={
          <p>
            Filtered original debits: <MoneyCell value={data.totals.debit} /> ·
            credits: <MoneyCell value={data.totals.credit} />. Reversal lines
            appear in each journal’s details.
          </p>
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search journals
            <input name="q" defaultValue={data.filters.q} maxLength={100} />
          </label>
          <label>
            Journal state
            <select name="state" defaultValue={data.filters.state}>
              {["ALL", "DRAFT", "POSTED", "REVERSED", "VOIDED"].map((s) => (
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
            Journal order
            <select name="sort" defaultValue={data.filters.sort}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="reference">Reference</option>
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
          <button type="submit">Apply journal filters</button>
        </form>
      </FinanceRegister>
      <JournalBatchVoid
        drafts={data.items
          .filter((i) => i.state === "DRAFT")
          .map((i) => ({
            id: i.id,
            reference: i.reference,
            version: i.version,
          }))}
        hosted={env.AUTH_PROVIDER === "supabase"}
      />
    </section>
  );
}
