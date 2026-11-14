import { financePageData } from "@/modules/finance/accounting/page-data";
import { AssetForm } from "@/modules/finance/components/asset-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New() {
  await financePageData(async () => null);
  return (
    <section>
      <FinanceNavigation />
      <h1>Register purchased asset</h1>
      <AssetForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
