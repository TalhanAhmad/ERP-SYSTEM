import { financePageData } from "@/modules/finance/accounting/page-data";
import { projectFinanceCandidate } from "@/modules/finance/projects/service";
import { CommercialProfileForm } from "@/modules/finance/components/commercial-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function New({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    c = await financePageData((a) =>
      q.projectId
        ? projectFinanceCandidate(a, q.projectId)
        : Promise.resolve(null),
    );
  if (c?.registered) redirect("/finance/projects/" + c.id);
  return (
    <section>
      <FinanceNavigation />
      <h1>New commercial project profile</h1>
      <section className="panel">
        <CommercialProfileForm
          hosted={env.AUTH_PROVIDER === "supabase"}
          projectId={c?.id}
          projectName={c?.name}
        />
      </section>
    </section>
  );
}
