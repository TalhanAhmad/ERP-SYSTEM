import { financePageData } from "@/modules/finance/accounting/page-data";
import { env } from "@/server/env";
import { LoanForm } from "@/modules/finance/components/loan-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function New() {
  await financePageData(async () => null);
  return (
    <section>
      <FinanceNavigation />
      <h1>New loan agreement</h1>
      <LoanForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
