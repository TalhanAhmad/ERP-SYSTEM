import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { costAllocationDetail } from "@/modules/finance/projects/costs/service";
import {
  CostAllocationForm,
  CostAllocationAction,
} from "@/modules/finance/components/cost-forms";
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
    d = await financePageData((a) => costAllocationDetail(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase",
    j = i.sourceLine.journal;
  const resource =
    j.sourceType === "BILL"
      ? "bills"
      : j.sourceType === "JOURNAL_DRAFT"
        ? "journals"
        : j.sourceType === "MOVEMENT"
          ? "movements"
          : j.sourceType === "ASSET_MOVEMENT"
            ? "asset-movements"
            : j.sourceType === "CUSTOMER_DOCUMENT"
              ? "receipts"
              : j.sourceType === "SUPPLIER_DOCUMENT"
                ? "supplier-payments"
                : null;
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.kind} · {i.reversedBy ? "REVERSED" : i.state} · version {i.version}
      </p>
      <section className="panel" aria-label="Cost allocation preview">
        <h2>Cost allocation preview</h2>
        <p>{i.description}</p>
        <p>
          Posting {i.postingDate} · Reviewed net cost{" "}
          <MoneyCell value={i.amount} />
        </p>
        <p>Evidence: {i.evidence}</p>
        <p>
          Original source{" "}
          {resource ? (
            <Link href={"/finance/" + resource + "/" + j.sourceId}>
              {j.reference}
            </Link>
          ) : (
            j.reference
          )}{" "}
          · {i.sourceLine.account.code} · {i.sourceLine.description}
        </p>
        <ul>
          {i.targets.map((t) => (
            <li key={t.id}>
              {t.project ? (
                <Link href={"/finance/project-results/" + t.projectId}>
                  {t.project.name}
                </Link>
              ) : (
                "Shared company cost"
              )}
              : <MoneyCell value={t.amount} />
            </li>
          ))}
        </ul>
        {d.basisStale && (
          <p role="status">
            Source changed. Review the current source and save a new exact split
            before posting.
          </p>
        )}
        {i.reversalOf && (
          <Link href={"/finance/cost-allocations/" + i.reversalOf.id}>
            Original {i.reversalOf.number}
          </Link>
        )}
        {i.reversedBy && (
          <Link href={"/finance/cost-allocations/" + i.reversedBy.id}>
            Reversal {i.reversedBy.number}
          </Link>
        )}
      </section>
      {i.state === "DRAFT" && (
        <section className="panel">
          <h2>Edit cost allocation draft</h2>
          <CostAllocationForm
            key={i.version}
            item={i}
            currentSource={d.currentSource}
            hosted={hosted}
          />
        </section>
      )}
      {(i.state === "DRAFT"
        ? (["POST", "VOID"] as const)
        : i.state === "POSTED" && i.kind !== "REVERSAL" && !i.reversedBy
          ? (["REVERSE"] as const)
          : []
      ).map((action) => (
        <section
          className="panel"
          aria-label={action + " cost allocation"}
          key={action}
        >
          <h2>{action} cost allocation</h2>
          <CostAllocationAction item={i} action={action} hosted={hosted} />
        </section>
      ))}
      {i.entry && (
        <section className="panel">
          <h2>Posted allocation journal</h2>
          <p>
            {i.entry.reference} · {i.entry.postingDate}
          </p>
          <div
            className="table-wrap"
            role="region"
            aria-label="Allocation journal lines"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Project</th>
                  <th>Debit (PKR)</th>
                  <th>Credit (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {i.entry.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.account.code} · {l.account.name}
                    </td>
                    <td>{l.project?.name ?? "Shared company"}</td>
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
      <SetupHistory events={d.history} />
    </section>
  );
}
