import { financePageData } from "@/modules/finance/accounting/page-data";
import { assetDetail } from "@/modules/finance/assets/service";
import { AssetLifecycleForm } from "@/modules/finance/components/asset-lifecycle-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    d = await financePageData((a) => assetDetail(a, q.assetId ?? ""));
  return (
    <section>
      <FinanceNavigation />
      <h1>
        {q.generate === "1"
          ? "Monthly depreciation draft"
          : "New asset movement"}
      </h1>
      <p>
        {d.item.tag} · {d.item.number}
      </p>
      <section className="panel">
        <AssetLifecycleForm
          assetId={d.item.id}
          hosted={env.AUTH_PROVIDER === "supabase"}
          generate={q.generate === "1"}
        />
      </section>
    </section>
  );
}
