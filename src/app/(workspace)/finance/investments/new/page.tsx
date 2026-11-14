import { financePageData } from "@/modules/finance/accounting/page-data";
import { env } from "@/server/env";
import { HoldingForm } from "@/modules/finance/components/investment-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function New() {
  await financePageData(async () => null);
  return (
    <section>
      <FinanceNavigation />
      <h1>New investment holding</h1>
      <HoldingForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
