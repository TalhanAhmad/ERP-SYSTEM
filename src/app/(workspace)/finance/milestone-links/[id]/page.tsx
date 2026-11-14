import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { milestoneLinkDetail } from "@/modules/finance/projects/service";
import { CommercialLinkRelease } from "@/modules/finance/components/commercial-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function LinkDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => milestoneLinkDetail(a, id)),
    i = d.item;
  return (
    <section>
      <FinanceNavigation />
      <h1>Milestone invoice relationship</h1>
      <p>
        {i.state} · version {i.version}
      </p>
      <section className="panel" aria-label="Linked invoice evidence">
        <h2>Linked invoice evidence</h2>
        <p>
          Milestone{" "}
          <Link href={"/finance/billing-milestones/" + i.milestoneId}>
            {i.milestone.number}
          </Link>{" "}
          · Project{" "}
          <Link href={"/finance/projects/" + i.milestone.profile.projectId}>
            {i.milestone.profile.project.name}
          </Link>
        </p>
        <p>
          <Link href={"/finance/invoices/" + i.invoiceLine.invoiceId}>
            Invoice {i.invoiceLine.invoice.number} · line{" "}
            {i.invoiceLine.sequence}
          </Link>
        </p>
        <p>
          Original billed net before later credits{" "}
          <MoneyCell value={i.originalNet} />
        </p>
        {i.releaseReason && <p>Release reason: {i.releaseReason}</p>}
        <p>
          This retained relationship records the commercial plan’s source.
          Current invoice settlement and credit history is available on the
          invoice.
        </p>
      </section>
      {i.state === "ACTIVE" && (
        <section className="panel" aria-label="Release invoice relationship">
          <h2>Release invoice relationship</h2>
          <CommercialLinkRelease
            item={i}
            hosted={env.AUTH_PROVIDER === "supabase"}
          />
        </section>
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
