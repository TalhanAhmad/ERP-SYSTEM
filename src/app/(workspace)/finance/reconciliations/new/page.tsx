import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { reconciliationDetail } from "@/modules/finance/treasury/reconciliation/service";
import { ReconciliationCreateForm } from "@/modules/finance/components/reconciliation-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  const prior = q.replacesId
    ? (await financePageData((a) => reconciliationDetail(a, q.replacesId!)))
        .item
    : undefined;
  await financePageData((a) => financeStatus(a));
  return (
    <section>
      <FinanceNavigation />
      <h1>Review bank reconciliation</h1>
      <section className="panel">
        <ReconciliationCreateForm
          hosted={env.AUTH_PROVIDER === "supabase"}
          prior={prior}
        />
      </section>
    </section>
  );
}
