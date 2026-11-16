import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { reconciliationDetail } from "@/modules/finance/treasury/reconciliation/service";
import {
  ReconciliationAction,
  ReconciliationNotes,
} from "@/modules/finance/components/reconciliation-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Detail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData((a) =>
      reconciliationDetail(a, id, { page: q.page }),
    ),
    i = d.item,
    r = d.review,
    t = r.totals,
    hosted = env.AUTH_PROVIDER === "supabase",
    ready =
      !r.basisStale &&
      !r.undocumentedCount &&
      !r.unresolvedCount &&
      t.explainedDifference === "0.00";
  const metrics = [
    ["Opening statement balance", t.openingStatementBalance],
    ["Closing statement balance", t.closingStatementBalance],
    ["Posted GL bank balance", t.glBankBalance],
    ["Outstanding deposits", t.outstandingDeposits],
    ["Outstanding payments", t.outstandingPayments],
    [
      "Unresolved bank receipts before reviewed duplicate exclusions",
      t.unresolvedBankReceipts,
    ],
    [
      "Unresolved bank payments before reviewed duplicate exclusions",
      t.unresolvedBankPayments,
    ],
    ["Explained difference", t.explainedDifference],
  ];
  const resources: Record<string, string> = {
    MOVEMENT: "movements",
    CUSTOMER_DOCUMENT: "receipts",
    SUPPLIER_DOCUMENT: "supplier-payments",
    BILL: "bills",
    ASSET_MOVEMENT: "asset-movements",
    JOURNAL_DRAFT: "journals",
  };
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.state} · version {i.version} · {i.cashAccount.name} ·{" "}
        {i.glAccount.code}
      </p>
      <section className="panel" aria-label="Reconciliation proof">
        <h2>Statement-to-GL proof</h2>
        <p>
          {i.companyName} · PKR · Posted accrual books / bank value dates ·{" "}
          {i.startDate} — {i.cutoffDate}
        </p>
        <p>
          Cutoff uses Pakistan time (Asia/Karachi). Proof generated{" "}
          {r.generatedAt}. Cash uses posting dates; bank evidence uses value
          dates. One retained statement’s balance is reviewed here; overlapping
          files are not silently merged or removed.
        </p>
        <p>
          {i.statementBatchId ? (
            <Link href={"/finance/statements/" + i.statementBatchId}>
              {i.statementBatch?.number}
            </Link>
          ) : (
            "Explicit zero-activity bank evidence"
          )}{" "}
          · {i.evidence}
        </p>
        <dl>
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <MoneyCell value={value} />
              </dd>
            </div>
          ))}
        </dl>
        <p>
          Equation: closing statement balance + outstanding deposits −
          outstanding payments − posted GL bank balance = explained difference.
        </p>
        <p>
          {r.undocumentedCount} undocumented cash items · {r.unresolvedCount}{" "}
          unresolved bank records. Every positive item needs review even when
          receipts/payments net to zero.
        </p>
        {r.basisStale && (
          <p className="error" role="alert">
            The source changed. Refresh this draft explicitly, then review the
            current items again. Refresh clears draft notes and retains the
            prior review in audit history.
            {r.sourceUnavailable
              ? " Its original source or mapping is unavailable; void the draft and choose a valid replacement."
              : ""}
          </p>
        )}
        {i.finalizedAt && (
          <p>
            Finalized {i.finalizedAt.toISOString()} by{" "}
            {i.finalizedBy?.displayName}. The issued snapshot is retained.
          </p>
        )}
        {i.reopenedAt && (
          <p>
            Superseded after owner reopening {i.reopenedAt.toISOString()} by{" "}
            {i.reopenedBy?.displayName}: {i.reopenReason}
          </p>
        )}
        {i.replaces && (
          <Link href={"/finance/reconciliations/" + i.replaces.id}>
            Original {i.replaces.number}
          </Link>
        )}
        {i.replacedBy && (
          <Link href={"/finance/reconciliations/" + i.replacedBy.id}>
            Replacement {i.replacedBy.number}
          </Link>
        )}
      </section>
      <section className="panel" aria-label="Outstanding reconciliation items">
        <h2>Outstanding items</h2>
        <p>
          {r.total} retained review items · Page {r.page} of {r.pages}
        </p>
        <ol start={(r.page - 1) * 25 + 1}>
          {r.items.map((row) => {
            const source = row.source,
              resource = source.sourceType
                ? resources[source.sourceType]
                : null;
            return (
              <li key={row.key}>
                <p>
                  {source.kind === "STATEMENT" ? (
                    <Link href={"/finance/statements/" + source.batchId}>
                      {source.number}
                    </Link>
                  ) : resource ? (
                    <Link href={"/finance/" + resource + "/" + source.sourceId}>
                      {source.reference}
                    </Link>
                  ) : (
                    source.reference
                  )}{" "}
                  · {source.date} · {source.direction} · Original{" "}
                  <MoneyCell value={source.amount} /> / matched at cutoff{" "}
                  <MoneyCell value={row.allocated} /> / remaining{" "}
                  <MoneyCell value={row.remaining} />
                </p>
                <p>{source.description}</p>
                {row.review && (
                  <p>
                    {row.review.kind}: {row.review.note}
                    {row.review.peerStatementLineId
                      ? " · Matched original record " +
                        row.review.peerStatementLineId
                      : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {!r.total && <p>No outstanding items in this source proof.</p>}
        <div className="form-actions">
          {r.page > 1 && (
            <Link href={"?page=" + (r.page - 1)}>Previous review items</Link>
          )}
          {r.page < r.pages && (
            <Link href={"?page=" + (r.page + 1)}>Next review items</Link>
          )}
        </div>
        {i.state === "DRAFT" && !!r.items.length && (
          <ReconciliationNotes
            key={i.version + ":" + r.page}
            id={id}
            version={i.version}
            items={r.items}
            hosted={hosted}
            page={r.page}
          />
        )}
      </section>
      {i.state === "DRAFT" && (
        <section className="panel">
          <h2>Confirm reviewed bank balance</h2>
          <p>
            Finalization requires zero explained difference, no unresolved bank
            records and documentation for every outstanding cash item. It also
            checks the current source and open cutoff period independently.
          </p>
          <ReconciliationAction
            id={id}
            version={i.version}
            action="FINALIZE"
            label="Finalize reconciliation"
            hosted={hosted}
            disabled={!ready}
          />
          <h2>Refresh draft source</h2>
          <p>
            This explicitly replaces the draft proof with current source
            positions and clears all its draft notes. The previous review
            remains in audit history.
          </p>
          <ReconciliationAction
            id={id}
            version={i.version}
            action="REFRESH"
            label="Refresh source and clear notes"
            hosted={hosted}
          />
          <h2>Retain and void draft</h2>
          <ReconciliationAction
            id={id}
            version={i.version}
            action="VOID"
            label="Void draft review"
            hosted={hosted}
          />
        </section>
      )}
      {i.state === "FINALIZED" && d.isOwner && (
        <section className="panel">
          <h2>Owner correction</h2>
          <p>
            Reopen the latest affected cutoff first. This supersedes the issued
            proof and permits reviewed historical corrections; its original
            snapshot remains retained.
          </p>
          <ReconciliationAction
            id={id}
            version={i.version}
            action="REOPEN"
            label="Reopen bank reconciliation"
            hosted={hosted}
          />
        </section>
      )}
      {["REOPENED", "VOIDED"].includes(i.state) && !i.replacedBy && (
        <Link
          className="primary"
          href={"/finance/reconciliations/new?replacesId=" + i.id}
        >
          Create linked replacement review
        </Link>
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
