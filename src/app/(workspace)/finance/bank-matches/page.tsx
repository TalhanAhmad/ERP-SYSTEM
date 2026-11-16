import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { bankMatches } from "@/modules/finance/treasury/matching/service";
import { bankMatchQuerySchema } from "@/modules/finance/treasury/matching/schemas";
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
      const q = bankMatchQuerySchema.safeParse(raw);
      return bankMatches(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Bank matching</h1>
      <Link href="/finance/bank-matches/new">Match bank records</Link>
      <p>
        Explicit associations between imported bank evidence and actual posted
        cash entries. Undo preserves original allocations and opposite events.
      </p>
      <FinanceRegister
        drawer={false}
        label="Bank match"
        columns={["Bank", "Effective dates", "Description", "State"]}
        rows={d.items.map((b) => ({
          id: b.id,
          name: b.number,
          href: "/finance/bank-matches/" + b.id,
          endpoint: "/api/v1/finance/bank-matches/" + b.id,
          cells: [
            b.cashAccount.name,
            b.earliestDate + " — " + b.latestDate,
            b.description,
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
            Search matching groups
            <input name="q" maxLength={100} defaultValue={d.filters.q} />
          </label>
          <label>
            Matching state
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "MATCHED", "UNMATCHED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter matching groups</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
