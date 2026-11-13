import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { BillForm } from "@/modules/finance/components/bill-forms";
export const dynamic = "force-dynamic";
export default async function NewBill() {
  await financePageData(financeStatus);
  return (
    <section>
      <FinanceNavigation />
      <h1>New bill draft</h1>
      <BillForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
