import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { ExportCreateForm } from "@/modules/finance/components/export-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
import { workDate } from "@/lib/dates";
export const dynamic = "force-dynamic";
export default async function NewExport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await financePageData((a) => financeStatus(a));
  const q = await searchParams;
  return (
    <section>
      <FinanceNavigation />
      <h1>Prepare report export</h1>
      <section className="panel">
        <ExportCreateForm
          hosted={env.AUTH_PROVIDER === "supabase"}
          today={workDate()}
          initial={q}
        />
      </section>
    </section>
  );
}
