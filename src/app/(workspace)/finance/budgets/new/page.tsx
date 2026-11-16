import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { budgetDetail } from "@/modules/finance/planning/service";
import { BudgetForm } from "@/modules/finance/components/planning-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  await financePageData((a) => financeStatus(a));
  const previous = q.previousId
    ? await financePageData((a) => budgetDetail(a, q.previousId!))
    : null;
  return (
    <section>
      <FinanceNavigation />
      <h1>{previous ? "New budget revision" : "New budget draft"}</h1>
      {!previous || previous.item.state === "APPROVED" ? (
        <section className="panel">
          <BudgetForm
            previous={previous?.item}
            hosted={env.AUTH_PROVIDER === "supabase"}
            projectId={q.projectId}
          />
        </section>
      ) : (
        <p>Open the current approved budget before starting a revision.</p>
      )}
    </section>
  );
}
