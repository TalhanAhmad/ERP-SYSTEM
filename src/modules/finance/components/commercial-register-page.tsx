import {
  commercialChildren,
  type CommercialChildKind,
} from "../projects/service";
import { commercialChildQuerySchema } from "../projects/schemas";
import { financePageData } from "../accounting/page-data";
import { FinanceNavigation } from "./setup-navigation";
import { FinanceRegister } from "./finance-register";
import { MoneyCell } from "./money-cell";
export async function CommercialRegisterPage({
  kind,
  raw,
}: {
  kind: CommercialChildKind;
  raw: Record<string, string | string[] | undefined>;
}) {
  const d = await financePageData((a) => {
      const q = commercialChildQuerySchema.safeParse(raw);
      return commercialChildren(a, kind, q.success ? q.data : {});
    }),
    base = kind === "VARIATION" ? "project-variations" : "billing-milestones",
    states =
      kind === "VARIATION"
        ? ["ALL", "DRAFT", "APPROVED", "VOIDED"]
        : ["ALL", "DRAFT", "CONFIRMED", "CANCELLED"];
  return (
    <section>
      <FinanceNavigation />
      <h1>
        {kind === "VARIATION" ? "Project variations" : "Billing milestones"}
      </h1>
      <p>
        Open a commercial project to create a draft. Confirmed commercial
        records are retained with their review history.
      </p>
      <FinanceRegister
        drawer={false}
        label={kind === "VARIATION" ? "Variation" : "Billing milestone"}
        columns={[
          "Record",
          "Project",
          "Description",
          "Value (PKR)",
          kind === "VARIATION" ? "Signed date" : "Expected billing",
          "State",
        ]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/" + base + "/" + i.id,
          endpoint: "/api/v1/finance/" + base + "/" + i.id,
          cells: [
            i.projectName,
            i.description,
            <MoneyCell key="value" value={i.amount} />,
            i.date,
            i.state,
          ],
        }))}
        total={d.total}
        pages={d.pages}
        page={d.page}
        href={(page) =>
          "?" + new URLSearchParams({ ...d.filters, page: String(page) })
        }
      >
        <form method="get" className="form-grid">
          {d.filters.projectId && (
            <input type="hidden" name="projectId" value={d.filters.projectId} />
          )}
          <label>
            Search commercial records
            <input name="q" defaultValue={d.filters.q} maxLength={100} />
          </label>
          <label>
            State
            <select name="state" defaultValue={d.filters.state}>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter commercial records</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
