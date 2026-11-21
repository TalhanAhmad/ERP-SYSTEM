import Link from "next/link";
import { notFound } from "next/navigation";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  recurringSchedules,
  recurringRuns,
} from "@/modules/finance/automation/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import {
  RecurringCreateForm,
  AutomationChange,
} from "@/modules/finance/components/automation-forms";
import { ExportRows } from "@/modules/finance/components/export-view";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Automation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { view = "schedules", ...q } = await searchParams;
  if (!["schedules", "runs"].includes(view)) notFound();
  const d = await financePageData<
      import("@/modules/finance/automation/types").AutomationPaging<
        | import("@/modules/finance/automation/types").Schedule
        | import("@/modules/finance/automation/types").RecurringRun
      >
    >((a) =>
      view === "runs" ? recurringRuns(a, q) : recurringSchedules(a, q),
    ),
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>Recurring drafts</h1>
      <p>
        Reviewed monthly obligations and adjustments prepare drafts only. Each
        bill, journal or depreciation source needs a separate review and fresh
        verification before posting.
      </p>
      <div className="form-actions">
        <Link href="?view=schedules">Schedules</Link>
        <Link href="?view=runs">Preparation history</Link>
      </div>
      <section className="panel">
        <h2>
          {view === "runs" ? "Preparation history" : "Reviewed schedules"}
        </h2>
        <p>
          {d.total} records · Page {d.page} of {d.pages}
        </p>
        <ExportRows items={d.items} />
        {d.items.map((x) => (
          <p key={x.id}>
            <Link
              href={
                view === "runs"
                  ? `/finance/automation/runs/${x.id}`
                  : `/finance/automation/${x.id}`
              }
            >
              {"name" in x ? x.name : x.id}: open{" "}
              {view === "runs" ? "preparation" : "schedule"}
            </Link>
          </p>
        ))}
        {d.page > 1 && (
          <Link href={`?view=${view}&page=${d.page - 1}`}>
            Previous records
          </Link>
        )}
        {d.page < d.pages && (
          <Link href={`?view=${view}&page=${d.page + 1}`}>Next records</Link>
        )}
      </section>
      {d.canManage && (
        <>
          <section className="panel">
            <h2>Prepare due drafts</h2>
            <AutomationChange hosted={hosted} action="PREPARE" />
          </section>
          <section className="panel">
            <h2>Create a recurring draft schedule</h2>
            <RecurringCreateForm hosted={hosted} />
          </section>
        </>
      )}
    </section>
  );
}
