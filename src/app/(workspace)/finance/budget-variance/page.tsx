import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { budgetVariance } from "@/modules/finance/planning/service";
import { VarianceFilters } from "@/modules/finance/components/planning-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Variance({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date()),
    month =
      parts.find((p) => p.type === "year")!.value +
      "-" +
      parts.find((p) => p.type === "month")!.value,
    d = await financePageData((a) =>
      budgetVariance(a, {
        month: q.month ?? month,
        projectId: q.projectId ?? "SHARED",
      }),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>Monthly budget variance</h1>
      <VarianceFilters
        month={d.filters.month}
        projectId={d.project?.id ?? null}
        projectName={d.project?.name}
      />
      <section className="panel" aria-label="Budget variance result">
        <h2>
          {d.project?.name ?? "Shared company"} · {d.filters.month}
        </h2>
        {d.budget ? (
          <p>
            Current approved plan{" "}
            <Link href={"/finance/budgets/" + d.budget.id}>
              {d.budget.number} · Revision {d.budget.revision}
            </Link>
          </p>
        ) : (
          <p>
            No approved budget for this month and scope. Actual expense remains
            visible.
          </p>
        )}
        <p>
          Approved budget <MoneyCell value={d.totals.budget} /> · Incurred
          actuals <MoneyCell value={d.totals.actual} /> · Budget remaining{" "}
          <MoneyCell value={d.totals.remaining} />
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Budget variance accounts"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Expense account</th>
                <th>Approved budget (PKR)</th>
                <th>Incurred actual (PKR)</th>
                <th>Remaining (PKR)</th>
                <th>Advisory</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((r) => (
                <tr key={r.accountId}>
                  <td>
                    {r.code} · {r.name}
                    {!r.mappingAvailable && (
                      <p>
                        Current mapping needs review before a new budget
                        approval.
                      </p>
                    )}
                  </td>
                  <td>
                    <MoneyCell value={r.budget} />
                  </td>
                  <td>
                    <MoneyCell value={r.actual} />
                  </td>
                  <td>
                    <MoneyCell value={r.remaining} />
                  </td>
                  <td>
                    {r.unbudgeted
                      ? "Unbudgeted expense"
                      : r.exceeded
                        ? "Above approved budget"
                        : "Within plan"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Actuals include posted unpaid bills and dated project
          reclassifications/credits. Warnings are advisory and do not block
          required expense recognition. Forecast cash plans are separate.
        </p>
      </section>
    </section>
  );
}
