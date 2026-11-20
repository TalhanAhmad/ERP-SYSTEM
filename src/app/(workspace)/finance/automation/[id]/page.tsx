import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { recurringSchedule } from "@/modules/finance/automation/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import {
  ExportRows,
  ExportValues,
} from "@/modules/finance/components/export-view";
import { AutomationChange } from "@/modules/finance/components/automation-forms";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Schedule({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData((a) => recurringSchedule(a, id, q)),
    s = d.schedule;
  return (
    <section>
      <FinanceNavigation />
      <h1>{s.name}</h1>
      <section className="panel">
        <h2>Reviewed draft schedule</h2>
        <p>
          {s.active ? "Active" : "Paused"} · {s.kind} · Every month on day{" "}
          {s.day} · {s.startMonth} through {s.endMonth ?? "no fixed end"}
        </p>
        <p>{s.evidence}</p>
        <ExportValues value={s.template} />
        <p>
          Template and original authorization remain retained. To change the
          amount, source or policy, pause this schedule and create a newly
          reviewed one. Cancellation never posts or deletes a source.
        </p>
      </section>
      <section className="panel">
        <h2>Preparation history</h2>
        <p>
          {d.total} runs · Page {d.page} of {d.pages}
        </p>
        <ExportRows items={d.items} />
        {d.items.map((x) => (
          <p key={x.id}>
            <Link href={`/finance/automation/runs/${x.id}`}>
              {x.month}: {x.state}
            </Link>
          </p>
        ))}
        {d.page > 1 && (
          <Link href={`?page=${d.page - 1}`}>Previous months</Link>
        )}
        {d.page < d.pages && (
          <Link href={`?page=${d.page + 1}`}>Next months</Link>
        )}
      </section>
      {d.canManage && (
        <section className="panel">
          <h2>{s.active ? "Pause schedule" : "Resume schedule"}</h2>
          <AutomationChange
            hosted={env.AUTH_PROVIDER === "supabase"}
            action={s.active ? "PAUSE" : "RESUME"}
            id={s.id}
            version={s.version}
          />
        </section>
      )}
      <p>
        <Link href="/finance/automation">Back to recurring drafts</Link>
      </p>
    </section>
  );
}
