import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { holdingDetail } from "@/modules/finance/investments/service";
import {
  HoldingForm,
  HoldingArchiveForm,
} from "@/modules/finance/components/investment-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Holding({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => holdingDetail(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>
        {i.number} · {i.name}
      </h1>
      <p>
        {i.party.name} · {i.investmentType} · {i.unitMode} · {i.classification}{" "}
        · {i.active ? "ACTIVE" : "ARCHIVED"} · version {i.version}
      </p>
      <section className="panel" aria-label="Investment policy">
        <h2>Recorded measurement policy</h2>
        <p>
          {i.policyStatus} · {i.measurementMode} · {i.valuationTreatment}
        </p>
        <p>{i.policy}</p>
        <p>Evidence {i.evidence}</p>
        <p>
          Investment control {i.investmentAccount.code} ·{" "}
          {i.investmentAccount.name}
        </p>
        <p>
          Original cost <MoneyCell value={d.originalCost} /> · Carrying value{" "}
          <MoneyCell value={d.carryingValue} /> · Units{" "}
          {d.units ?? "Amount based"}
        </p>
        <p>
          Realized disposal result before fees{" "}
          <MoneyCell value={d.realizedResult} /> · Disposal fees{" "}
          <MoneyCell value={d.fees} />
        </p>
        <p>
          Valuation changes <MoneyCell value={d.valuationChanges} /> ·
          Impairments <MoneyCell value={d.impairments} />
        </p>
        <p>
          Investment income earned <MoneyCell value={d.incomeEarned} /> · Income
          receivable <MoneyCell value={d.incomeReceivable} />
        </p>
        <p>
          Recorded policy and book values do not assert regulatory compliance or
          current market value.
        </p>
      </section>
      <div className="form-actions">
        {i.active && i.policyStatus === "REVIEWED" && (
          <Link
            className="button secondary"
            href={"/finance/investments/" + id + "/movements/new"}
          >
            Record disposal, income or value change
          </Link>
        )}
        {i.active && i.policyStatus === "REVIEWED" && (
          <Link
            className="button primary"
            href={"/finance/investments/" + id + "/acquisitions/new"}
          >
            Record acquisition
          </Link>
        )}
        <Link href={"/finance/investments/" + id + "/lots"}>
          View acquisition lots
        </Link>
      </div>
      {!i.usedAt && (
        <section className="panel">
          <h2>Edit unposted policy</h2>
          <HoldingForm item={i} key={i.version} hosted={hosted} />
        </section>
      )}
      <section className="panel">
        <h2>Latest movements</h2>
        <p>Latest25 source records.</p>
        {d.movements.map((m) => (
          <p key={m.id}>
            <Link href={"/finance/movements/" + m.id}>{m.number}</Link> ·{" "}
            {m.kind.replaceAll("_", " ")} · {m.state} · {m.postingDate} ·{" "}
            <MoneyCell value={m.amount} />
          </p>
        ))}
      </section>
      <section className="panel">
        <h2>{i.active ? "Archive empty holding" : "Reactivate holding"}</h2>
        <HoldingArchiveForm item={i} hosted={hosted} />
      </section>
      <SetupHistory events={d.history} />
    </section>
  );
}
