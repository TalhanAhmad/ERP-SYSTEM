import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { CostAllocationForm } from "@/modules/finance/components/cost-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New() {
  await financePageData((a) => financeStatus(a));
  return (
    <section>
      <FinanceNavigation />
      <h1>New cost allocation</h1>
      <section className="panel">
        <CostAllocationForm hosted={env.AUTH_PROVIDER === "supabase"} />
      </section>
    </section>
  );
}
