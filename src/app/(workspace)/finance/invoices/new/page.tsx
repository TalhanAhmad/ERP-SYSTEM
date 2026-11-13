import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { InvoiceForm } from "@/modules/finance/components/invoice-forms";
export const dynamic = "force-dynamic";
export default async function NewInvoice() {
  await financePageData(financeStatus);
  return (
    <section>
      <FinanceNavigation />
      <h1>New invoice draft</h1>
      <InvoiceForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
