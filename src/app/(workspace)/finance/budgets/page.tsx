import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { budgets } from "@/modules/finance/planning/service";
import { budgetQuerySchema } from "@/modules/finance/planning/schemas";
export const dynamic = "force-dynamic";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    d = await financePageData((a) => {
      const p = budgetQuerySchema.safeParse(q);
      return budgets(a, p.success ? p.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Monthly cost budgets</h1>
      <Link href="/finance/budgets/new">New budget draft</Link>
      <Link href="/finance/budget-variance">View budget variance</Link>
      <p>
        Approved monthly plans compare with incurred expense. Drafts and
        revisions do not post accounting entries.
      </p>
      <FinanceRegister
        drawer={false}
        label="Budget"
        columns={["Month / scope", "Revision", "Planned cost (PKR)", "State"]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/budgets/" + i.id,
          endpoint: "/api/v1/finance/budgets/" + i.id,
          cells: [
            i.month + " · " + (i.project?.name ?? "Shared company"),
            String(i.revision),
            <MoneyCell key="amount" value={i.total} />,
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
            Search budgets
            <input name="q" maxLength={100} defaultValue={d.filters.q} />
          </label>
          <label>
            Budget month
            <input
              type="month"
              name="month"
              min="0001-01"
              max="9999-12"
              defaultValue={d.filters.month}
            />
          </label>
          <label>
            Budget state
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "DRAFT", "APPROVED", "SUPERSEDED", "VOIDED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter budgets</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
