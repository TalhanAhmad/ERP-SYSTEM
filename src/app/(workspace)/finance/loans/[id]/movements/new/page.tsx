import { financePageData } from "@/modules/finance/accounting/page-data";
import { loanDetail } from "@/modules/finance/funding/loans/service";
import { LoanMovementForm } from "@/modules/finance/components/loan-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => loanDetail(a, id));
  return (
    <section>
      <FinanceNavigation />
      <h1>New loan movement</h1>
      <LoanMovementForm
        loan={d.item}
        hosted={env.AUTH_PROVIDER === "supabase"}
      />
    </section>
  );
}
