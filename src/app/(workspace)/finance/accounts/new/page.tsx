import { notFound } from "next/navigation";
import { env } from "@/server/env";
import { accounts } from "@/modules/finance/accounting/service";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { AccountForm } from "@/modules/finance/components/setup-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function NewAccount() {
  const data = await financePageData((actor) => accounts(actor));
  if (!data.canManage) notFound();
  return (
    <section>
      <FinanceNavigation />
      <h1>New account</h1>
      <p>
        Choose the approved classification. No company chart or balance is
        assumed.
      </p>
      <section className="panel" aria-label="Create account">
        <AccountForm
          groups={data.groups}
          hosted={env.AUTH_PROVIDER === "supabase"}
        />
      </section>
    </section>
  );
}
