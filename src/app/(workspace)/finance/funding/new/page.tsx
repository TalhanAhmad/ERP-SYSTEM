import { financePageData } from "@/modules/finance/accounting/page-data";
import { env } from "@/server/env";
import { FundingForm } from "@/modules/finance/components/funding-form";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function New() {
  await financePageData(async () => null);
  return (
    <section>
      <FinanceNavigation />
      <h1>New funding draft</h1>
      <FundingForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
