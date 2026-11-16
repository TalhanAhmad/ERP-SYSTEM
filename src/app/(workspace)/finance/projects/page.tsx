import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { commercialProjects } from "@/modules/finance/projects/service";
import { projectQuerySchema } from "@/modules/finance/projects/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Projects({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    d = await financePageData((a) => {
      const q = projectQuerySchema.safeParse(raw);
      return commercialProjects(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Commercial projects</h1>
      <p>
        Private agreements, signed changes and billing plans linked to workspace
        projects. Commercial value is separate from recognized revenue and cash.
      </p>
      <Link className="button primary" href="/finance/projects/new">
        Create commercial profile
      </Link>
      <FinanceRegister
        drawer={false}
        label="Commercial project"
        columns={[
          "Project",
          "Client",
          "Commercial state",
          "Contract value (PKR)",
          "Confirmed billing plans (PKR)",
          "Billing model",
        ]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.project.name,
          href: "/finance/projects/" + i.projectId,
          endpoint: "/api/v1/finance/projects/" + i.projectId,
          cells: [
            i.client.name,
            i.state,
            <MoneyCell key="contract" value={i.totals.contractValue} />,
            <MoneyCell key="plans" value={i.totals.confirmedMilestones} />,
            i.billingModel.replaceAll("_", " "),
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
          <label>
            Search commercial projects
            <input name="q" maxLength={100} defaultValue={d.filters.q} />
          </label>
          <label>
            State
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "DRAFT", "ACTIVE", "CLOSED", "CANCELLED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter projects</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
