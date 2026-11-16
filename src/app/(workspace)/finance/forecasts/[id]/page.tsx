import { financePageData } from "@/modules/finance/accounting/page-data";
import { forecastDetail } from "@/modules/finance/planning/service";
import {
  ForecastForm,
  ForecastAction,
} from "@/modules/finance/components/planning-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => forecastDetail(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.kind} · {i.state} · version {i.version}
      </p>
      <section className="panel" aria-label="Expected cash plan">
        <h2>Expected cash plan</h2>
        <p>{i.description}</p>
        <p>
          Expected date {i.expectedDate} · Expected amount{" "}
          <MoneyCell value={i.amount} />
        </p>
        <p>
          {i.project?.name ?? "Shared company"} ·{" "}
          {i.party?.name ?? "No specific party"}
        </p>
        <p>
          {i.likelihood} · {i.likelihoodNote}
        </p>
        <p>Evidence: {i.evidence}</p>
        <p>
          This forecast does not record a receipt, payment or accounting entry.
        </p>
      </section>
      {i.state === "ACTIVE" && (
        <section className="panel">
          <h2>Edit cash forecast</h2>
          <ForecastForm key={i.version} item={i} hosted={hosted} />
        </section>
      )}
      <section className="panel" aria-label="Forecast status action">
        <h2>{i.state === "ACTIVE" ? "Cancel forecast" : "Reopen forecast"}</h2>
        <ForecastAction item={i} hosted={hosted} />
      </section>
      <SetupHistory events={d.history} />
    </section>
  );
}
