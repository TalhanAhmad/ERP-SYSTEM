import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { BankMatchForm } from "@/modules/finance/components/bank-match-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New() {
  await financePageData((a) => financeStatus(a));
  return (
    <section>
      <FinanceNavigation />
      <h1>New bank matching</h1>
      <section className="panel">
        <BankMatchForm hosted={env.AUTH_PROVIDER === "supabase"} />
      </section>
    </section>
  );
}
