import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { commercialChildDetail } from "@/modules/finance/projects/service";
import {
  CommercialMilestoneForm,
  CommercialChildAction,
  CommercialInvoiceLinkForm,
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
      commercialChildDetail(a, "MILESTONE", id, q),
    );
  if (d.kind !== "MILESTONE") throw Error("Commercial source mismatch");
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
        <h2>Billing plan</h2>
        <p>{i.description}</p>
        <p>
          Value <MoneyCell value={i.amount} />
        </p>
        <p>
          Expected billing {i.expectedDate} · Expected due {i.dueDate}
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
          <CommercialMilestoneForm
            item={i}
            projectId={i.profile.projectId}
            hosted={hosted}
            key={i.version}
          />
        </section>
      )}
      {(i.state === "DRAFT" && i.profile.state === "ACTIVE"
        ? (["CONFIRM", "CANCEL"] as const)
        : i.state === "CONFIRMED" ||
            (i.state === "DRAFT" && i.profile.state === "CLOSED")
          ? (["CANCEL"] as const)
          : []
      ).map((action) => (
        <section
          className="panel"
          key={action}
          aria-label={action + " commercial source"}
        >
          <h2>{action} commercial source</h2>
          <CommercialChildAction
            kind="MILESTONE"
            item={i}
            hosted={hosted}
            action={action}
          />
        </section>
      ))}
      {i.state === "CONFIRMED" && (
        <section className="panel" aria-label="Link reviewed invoice">
          <h2>Link reviewed invoice</h2>
          <CommercialInvoiceLinkForm item={i} hosted={hosted} />
        </section>
      )}
      <section className="panel" aria-label="Retained invoice relationships">
        <h2>Retained invoice relationships</h2>
        <p>
          {d.total} relationships · Page {d.page} of {d.pages}
        </p>
        <ul>
          {d.links.map((l) => (
            <li key={l.id}>
              <Link href={"/finance/milestone-links/" + l.id}>
                {l.invoiceLine.invoice.number} · line {l.invoiceLine.sequence}
              </Link>{" "}
              · {l.state} · Original net <MoneyCell value={l.originalNet} />
            </li>
          ))}
        </ul>
        {d.page > 1 && (
          <Link href={"?page=" + (d.page - 1)}>Previous relationships</Link>
        )}
        {d.page < d.pages && (
          <Link href={"?page=" + (d.page + 1)}>Next relationships</Link>
        )}
      </section>
      <SetupHistory events={d.history} />
    </section>
  );
}
