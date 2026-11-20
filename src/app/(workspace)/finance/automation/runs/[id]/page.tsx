import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { recurringRun } from "@/modules/finance/automation/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { ExportRows } from "@/modules/finance/components/export-view";
import { AutomationChange } from "@/modules/finance/components/automation-forms";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Run({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => recurringRun(a, id)),
    r = d.run,
    resource =
      r.sourceType === "BILL"
        ? "bills"
        : r.sourceType === "JOURNAL"
          ? "journals"
          : "asset-movements";
  return (
    <section>
      <FinanceNavigation />
      <h1>Monthly draft preparation</h1>
      <section className="panel">
        <h2>
          {r.month} · {r.state}
        </h2>
        <p>
          Posting date {r.postingDate.slice(0, 10)} · {r.attempts} attempts ·
          current retry allowance {r.budget}
        </p>
        {r.errorCode && (
          <p role="alert">
            Preparation stopped: {r.errorCode}. Review the source mappings,
            period and original authorization before retrying.
          </p>
        )}
        {r.sourceId && (
          <p>
            <Link href={`/finance/${resource}/${r.sourceId}`}>
              Open prepared source for independent review
            </Link>
          </p>
        )}
        <p>
          A completed preparation confirms a retained source exists. Review its
          current state and actual document before posting; this job never
          performs automatic posting.
        </p>
      </section>
      <section className="panel">
        <h2>Retained attempts</h2>
        <ExportRows items={d.attempts} />
      </section>
      {d.canManage && r.state === "FAILED" && r.attempts < 9 && (
        <section className="panel">
          <h2>Review and retry</h2>
          <AutomationChange
            hosted={env.AUTH_PROVIDER === "supabase"}
            action="RETRY"
            id={r.id}
            version={r.version}
          />
        </section>
      )}
      <p>
        <Link href={`/finance/automation/${r.scheduleId}`}>
          Open original schedule
        </Link>
      </p>
    </section>
  );
}
