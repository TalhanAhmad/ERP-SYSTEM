import { FundingForm } from "@/modules/finance/components/funding-form";
import Link from "next/link";
import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { movementDetail } from "@/modules/finance/treasury/service";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import {
  MovementForm,
  MovementAction,
} from "@/modules/finance/components/movement-forms";
import { EvidenceSection } from "@/modules/finance/components/evidence-section";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Movement({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    data = await financePageData((a) => movementDetail(a, id)),
    i = data.item,
    hosted = env.AUTH_PROVIDER === "supabase",
    snapshot = i.sourceSnapshot as {
      fromCash?: { name: string };
      toCash?: { name: string };
    } | null;
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.kind.replaceAll("_", " ")} · {i.state} · version {i.version} · PKR
      </p>
      <section className="panel" aria-label="Movement preview">
        <h2>Movement preview</h2>
        <p>{i.description}</p>
        <p>
          Reference {i.reference} · Document {i.documentDate} · Posted{" "}
          {i.postingDate}
        </p>
        <p>
          From {snapshot?.fromCash?.name ?? i.fromCash?.name ?? "—"} · To{" "}
          {snapshot?.toCash?.name ?? i.toCash?.name ?? "—"}
        </p>
        <p>
          Amount <MoneyCell value={i.amount} />
        </p>
        <p>Evidence: {i.evidence}</p>
        <p>
          Contributor: {i.party?.name ?? "—"} · Control:{" "}
          {i.controlAccount?.code ?? "—"}
        </p>
        {i.approvalEvidence && <p>Authorization: {i.approvalEvidence}</p>}
        {i.bill && (
          <Link href={"/finance/bills/" + i.bill.id}>
            Original bill {i.bill.number}
          </Link>
        )}
        {i.reversalOf && (
          <Link href={"/finance/movements/" + i.reversalOf.id}>
            Original {i.reversalOf.number}
          </Link>
        )}
      </section>
      {i.state === "DRAFT" && (
        <>
          <section className="panel" aria-label="Edit movement draft">
            <h2>Edit movement draft</h2>
            {i.kind === "TRANSFER" ? (
              <MovementForm key={i.version} item={i} hosted={hosted} />
            ) : (
              <FundingForm key={i.version} item={i} hosted={hosted} />
            )}
          </section>
          {(["POST", "VOID"] as const).map((action) => (
            <section
              className="panel"
              key={action}
              aria-label={
                action === "POST" ? "Post movement" : "Void movement draft"
              }
            >
              <h2>
                {action === "POST" ? "Post movement" : "Void movement draft"}
              </h2>
              <MovementAction item={i} action={action} hosted={hosted} />
            </section>
          ))}
        </>
      )}
      {i.state === "POSTED" && i.kind !== "REVERSAL" && (
        <section className="panel" aria-label="Reverse movement">
          <h2>Reverse movement</h2>
          <p>Create a dated opposite journal while preserving this source.</p>
          <MovementAction item={i} action="REVERSE" hosted={hosted} />
        </section>
      )}
      {i.entry && (
        <section className="panel" aria-label="Posted movement journal">
          <h2>Posted journal</h2>
          <p>
            {i.entry.reference} · {i.entry.postingDate}
          </p>
          <div
            className="table-wrap"
            role="region"
            aria-label="Movement journal lines"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Debit</th>
                  <th scope="col">Credit</th>
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
      {i.reversedBy && (
        <p>
          Dated reversal{" "}
          <Link href={"/finance/movements/" + i.reversedBy.id}>
            {i.reversedBy.number}
          </Link>{" "}
          · {i.reversedBy.postingDate}
        </p>
      )}
      <EvidenceSection
        sourceType="MOVEMENT"
        sourceId={i.id}
        state={i.storedState}
      />
      <SetupHistory events={data.history} />
    </section>
  );
}
