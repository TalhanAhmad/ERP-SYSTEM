import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { assetMovementDetail } from "@/modules/finance/assets/lifecycle/service";
import {
  AssetLifecycleForm,
  AssetLifecycleAction,
} from "@/modules/finance/components/asset-lifecycle-forms";
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
    d = await financePageData((a) => assetMovementDetail(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.kind.replaceAll("_", " ")} · {i.state} · version {i.version}
      </p>
      <Link href={"/finance/assets/" + i.assetId}>Asset {i.asset.tag}</Link>
      <section className="panel" aria-label="Asset movement preview">
        <h2>Asset movement preview</h2>
        <p>{i.description}</p>
        <p>
          Posting {i.postingDate} · Month {i.month ?? "—"} · Amount{" "}
          <MoneyCell value={i.amount} /> · Fees{" "}
          <MoneyCell value={i.feeAmount} />
        </p>
        <p>Evidence: {i.evidence}</p>
        <p>Authorization: {i.approvalEvidence}</p>
        {i.newLifeMonths && (
          <p>
            Revised life {i.newLifeMonths} months · Residual {i.newResidual} ·
            First month {i.newFirstMonth}
          </p>
        )}
      </section>
      {i.state === "DRAFT" && (
        <section className="panel">
          <h2>Edit asset movement draft</h2>
          <AssetLifecycleForm
            key={i.version}
            assetId={i.assetId}
            item={i}
            hosted={hosted}
          />
        </section>
      )}
      {(i.state === "DRAFT"
        ? (["REFRESH", "POST", "VOID"] as const)
        : i.state === "VOIDED"
          ? (["REOPEN"] as const)
          : i.kind !== "REVERSAL" && !i.reversedBy
            ? (["REVERSE"] as const)
            : []
      ).map((action) => (
        <section
          className="panel"
          key={action}
          aria-label={action + " asset movement"}
        >
          <h2>{action} asset movement</h2>
          <AssetLifecycleAction item={i} action={action} hosted={hosted} />
        </section>
      ))}
      {i.entry && (
        <section className="panel" aria-label="Asset movement journal">
          <h2>Posted journal</h2>
          <p>
            {i.entry.reference} · {i.entry.postingDate}
          </p>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Asset movement journal lines"
          >
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Debit</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {i.entry.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.account.code} · {l.account.name}
                    </td>
                    <td>
                      <MoneyCell value={l.debit} />
                    </td>
                    <td>
                      <MoneyCell value={l.credit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {i.event && !i.entry && (
        <p>
          This posted register event changes policy or records a zero charge. No
          zero-value journal was created.
        </p>
      )}
      {i.reversalOf && (
        <p>
          <Link href={"/finance/asset-movements/" + i.reversalOf.id}>
            Original {i.reversalOf.number}
          </Link>
        </p>
      )}
      {i.reversedBy && (
        <p>
          <Link href={"/finance/asset-movements/" + i.reversedBy.id}>
            Reversal {i.reversedBy.number}
          </Link>{" "}
          · {i.reversedBy.postingDate}
        </p>
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
