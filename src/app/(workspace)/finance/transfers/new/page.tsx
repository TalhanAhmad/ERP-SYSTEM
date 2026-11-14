import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MovementForm } from "@/modules/finance/components/movement-forms";
export const dynamic = "force-dynamic";
export default async function NewTransfer() {
  await financePageData(financeStatus);
  return (
    <section>
      <FinanceNavigation />
      <h1>New transfer draft</h1>
      <MovementForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
