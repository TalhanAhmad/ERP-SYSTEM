import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { projectFinanceDetail } from "@/modules/finance/projects/service";
import { CommercialVariationForm } from "@/modules/finance/components/commercial-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function New({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    d = await financePageData((a) =>
      projectFinanceDetail(a, q.projectId ?? ""),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>New signed variation draft</h1>
      <p>{d.item.project.name}</p>
      {d.item.state === "ACTIVE" ? (
        <section className="panel">
          <CommercialVariationForm
            projectId={d.item.projectId}
            hosted={env.AUTH_PROVIDER === "supabase"}
          />
        </section>
      ) : (
        <p>
          <Link href={"/finance/projects/" + d.item.projectId}>
            Open the commercial profile
          </Link>{" "}
          to reopen planning.
        </p>
      )}
    </section>
  );
}
