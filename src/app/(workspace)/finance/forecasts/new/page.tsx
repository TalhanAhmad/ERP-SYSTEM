import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { ForecastForm } from "@/modules/finance/components/planning-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await financePageData((a) => financeStatus(a));
  const q = await searchParams;
  return (
    <section>
      <FinanceNavigation />
      <h1>New cash forecast</h1>
      <section className="panel">
        <ForecastForm
          hosted={env.AUTH_PROVIDER === "supabase"}
          projectId={q.projectId}
        />
      </section>
    </section>
  );
}
