import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { commercialChildDetail } from "@/modules/finance/projects/service";
import {
  CommercialVariationForm,
  CommercialChildAction,
} from "@/modules/finance/components/commercial-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Detail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData((a) =>
      commercialChildDetail(a, "VARIATION", id, q),
    );
  if (d.kind !== "VARIATION") throw Error("Commercial source mismatch");
  const i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.state} · version {i.version}
      </p>
      <Link href={"/finance/projects/" + i.profile.projectId}>
        {i.profile.project.name} · Commercial profile
      </Link>
      <section className="panel" aria-label="Reviewed commercial source">
        <h2>Signed variation</h2>
        <p>{i.description}</p>
        <p>
          Value <MoneyCell value={i.amount} />
        </p>
        <p>
          {i.direction} · Reference {i.reference} · Signed {i.signedDate}
        </p>
        <p>Evidence: {i.evidence}</p>
        {i.approvalEvidence && <p>Approval: {i.approvalEvidence}</p>}
        <p>
          Commercial confirmation records a reviewed agreement or plan and
          creates no accounting entry.
        </p>
      </section>
      {i.state === "DRAFT" && i.profile.state === "ACTIVE" && (
        <section className="panel">
          <h2>Edit commercial draft</h2>
          <CommercialVariationForm
            item={i}
            projectId={i.profile.projectId}
            hosted={hosted}
            key={i.version}
          />
        </section>
      )}
      {(i.state === "DRAFT" && i.profile.state === "ACTIVE"
        ? (["APPROVE", "VOID"] as const)
        : []
      ).map((action) => (
        <section
          className="panel"
          key={action}
          aria-label={action + " commercial source"}
        >
          <h2>{action} commercial source</h2>
          <CommercialChildAction
            kind="VARIATION"
            item={i}
            hosted={hosted}
            action={action}
          />
        </section>
      ))}
      <SetupHistory events={d.history} />
    </section>
  );
}
