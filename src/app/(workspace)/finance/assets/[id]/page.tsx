import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { assetDetail } from "@/modules/finance/assets/service";
import {
  AssetForm,
  AssetVoidForm,
} from "@/modules/finance/components/asset-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Asset({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => assetDetail(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>
        {i.tag} · {i.number}
      </h1>
      <p>
        {i.state} · version {i.version}
      </p>
      <section className="panel" aria-label="Asset purchase and policy">
        <h2>Purchase and planned policy</h2>
        <p>{i.description}</p>
        <p>
          Location {i.location} · Custodian{" "}
          {i.custodian?.displayName ?? "Unassigned"}
        </p>
        <p>
          Original cost <MoneyCell value={i.cost} /> · Current cost{" "}
          <MoneyCell value={i.currentCost} /> · Initial residual{" "}
          <MoneyCell value={i.residualValue} /> · Accumulated depreciation{" "}
          <MoneyCell value={i.accumulatedDepreciation} /> · Carrying value{" "}
          <MoneyCell value={i.carryingValue} />
        </p>
        <p>
          Purchase {i.purchaseDate} · Recognized {i.sourcePostingDate} · In
          service {i.inServiceDate}
        </p>
        <p>
          Asset account {i.account.code} · {i.account.name}
        </p>
        {i.billLine && (
          <Link href={"/finance/bills/" + i.billLine.billId}>
            Purchase {i.billLine.bill.number} · line {i.billLine.sequence}
          </Link>
        )}
        {i.fundingMovement && (
          <Link href={"/finance/movements/" + i.fundingMovementId}>
            Founder-funded source {i.fundingMovement.number}
          </Link>
        )}
        <p>
          Useful life {i.usefulLifeMonths} months ·{" "}
          {i.depreciationMethod.replaceAll("_", " ")} ·{" "}
          {i.convention.replaceAll("_", " ")}
        </p>
        <p>
          First depreciation month{" "}
          {i.firstDepMonth ?? "Awaiting company confirmation"}
        </p>
        {i.policyEvidence && <p>Policy evidence {i.policyEvidence}</p>}
        <p>
          Registration adds no journal. Monthly generation creates drafts;
          posting requires a separate review.
        </p>
        {d.activePolicy && (
          <p>
            Active revised plan: {d.activePolicy.months} months from{" "}
            {d.activePolicy.firstMonth} · Depreciable base{" "}
            <MoneyCell value={d.activePolicy.base} /> · Residual{" "}
            <MoneyCell value={d.activePolicy.residual} />
          </p>
        )}
        {i.state === "REGISTERED" && (
          <div className="form-actions">
            <Link
              href={
                "/finance/asset-movements/new?assetId=" + i.id + "&generate=1"
              }
            >
              Generate monthly depreciation draft
            </Link>
            <Link href={"/finance/asset-movements/new?assetId=" + i.id}>
              Record asset movement
            </Link>
          </div>
        )}
        <Link href={"/finance/asset-movements?assetId=" + i.id}>
          View all asset movements
        </Link>
        <ul>
          {d.movements.map((m) => (
            <li key={m.id}>
              <Link href={"/finance/asset-movements/" + m.id}>
                {m.number} · {m.kind} · {m.month ?? m.postingDate}
              </Link>{" "}
              · {m.reversedBy ? "REVERSED" : m.state} ·{" "}
              <MoneyCell value={m.amount} />
            </li>
          ))}
        </ul>
      </section>
      {i.state === "REGISTERED" && (
        <>
          <section className="panel">
            <h2>Edit asset details</h2>
            <AssetForm item={i} key={i.version} hosted={hosted} />
          </section>
          {!i.usedAt && (
            <section className="panel" aria-label="Correct unused registration">
              <h2>Correct unused registration</h2>
              <AssetVoidForm item={i} hosted={hosted} />
            </section>
          )}
        </>
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
