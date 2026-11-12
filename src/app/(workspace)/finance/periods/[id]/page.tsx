import { env } from "@/server/env";
import { periodDetail } from "@/modules/finance/accounting/service";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  PeriodForm,
  PeriodVoid,
} from "@/modules/finance/components/setup-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Period({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const data = await financePageData(async (actor) =>
      periodDetail(actor, (await params).id),
    ),
    p = data.item;
  return (
    <section>
      <FinanceNavigation />
      <h1>{p.name}</h1>
      <p>
        {p.startDate.toISOString().slice(0, 10)} through{" "}
        {p.endDate.toISOString().slice(0, 10)} · {p.state}
      </p>
      {data.canManage && p.state === "OPEN" ? (
        <>
          <section className="panel" aria-label="Edit accounting period">
            <h2>Amend open period</h2>
            <PeriodForm
              key={`${p.version}:${p.usedAt}`}
              item={p}
              hosted={env.AUTH_PROVIDER === "supabase"}
            />
          </section>
          {!p.usedAt && (
            <section className="panel" aria-label="Void accounting period">
              <h2>Void unused period</h2>
              <p>
                Retain this record and release its dates for a corrected period.
                Used periods cannot be voided.
              </p>
              <PeriodVoid
                key={p.version}
                item={p}
                hosted={env.AUTH_PROVIDER === "supabase"}
              />
            </section>
          )}
        </>
      ) : (
        <div className="panel">
          <p>
            This period is read-only here. Only the Finance Owner manages
            open-period setup.
          </p>
        </div>
      )}
      <SetupHistory events={data.history} />
    </section>
  );
}
