import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { projectFinancialResult } from "@/modules/finance/projects/costs/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Result({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData((a) => projectFinancialResult(a, id, q));
  const labels: Record<keyof typeof d.values, string> = {
    netInvoiced: "Net invoiced (tax excluded)",
    recognizedIncome: "Recognized income",
    directCosts: "Direct incurred costs",
    assignedOverhead: "Assigned overhead",
    contribution: "Contribution",
    fullyAllocatedResult: "Result after assigned overhead",
    companyUnallocatedOverhead: "Company unallocated overhead",
    companyUnassignedDirectCosts: "Company unassigned direct costs",
  };
  return (
    <section>
      <FinanceNavigation />
      <h1>{d.project.name} · Project results</h1>
      <Link href={"/finance/projects/" + id}>Commercial profile</Link>
      <form method="get" className="form-grid">
        <label>
          From
          <input
            type="date"
            name="from"
            required
            defaultValue={d.filters.from}
          />
        </label>
        <label>
          Through
          <input type="date" name="to" required defaultValue={d.filters.to} />
        </label>
        <button type="submit">Update result dates</button>
      </form>
      <section className="panel" aria-label="Project financial result">
        <h2>Posted actuals (PKR)</h2>
        <dl>
          {Object.entries(d.values).map(([key, value]) => (
            <div key={key}>
              <dt>{labels[key as keyof typeof d.values]}</dt>
              <dd>
                <MoneyCell value={value} />
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Accounting dates {d.filters.from} through {d.filters.to}. Incurred
          costs include unpaid bills. Contract values and milestone plans do not
          recognize income. Company unallocated costs are shown separately and
          are not deducted again from this project.
        </p>
        <p>
          Cash collections, receivables and budget forecasts will be available
          in their dedicated reports.
        </p>
      </section>
    </section>
  );
}
