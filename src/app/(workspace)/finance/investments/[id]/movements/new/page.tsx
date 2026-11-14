import { financePageData } from "@/modules/finance/accounting/page-data";
import { holdingDetail } from "@/modules/finance/investments/service";
import { InvestmentMovementForm } from "@/modules/finance/components/investment-movement-form";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => holdingDetail(a, id));
  return (
    <section>
      <FinanceNavigation />
      <h1>New investment movement</h1>
      {d.item.active && d.item.policyStatus === "REVIEWED" ? (
        <InvestmentMovementForm
          holding={d.item}
          hosted={env.AUTH_PROVIDER === "supabase"}
        />
      ) : (
        <p>
          Review the policy and activate the holding before recording a
          movement.
        </p>
      )}
    </section>
  );
}
