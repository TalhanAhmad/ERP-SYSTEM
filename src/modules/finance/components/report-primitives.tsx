import Link from "next/link";
import { MoneyCell } from "./money-cell";
import type { ReportMetadata } from "../reports/service";
export function BalanceCell({ value }: { value: string }) {
  const negative = value.startsWith("-"),
    absolute = negative ? value.slice(1) : value;
  return (
    <span>
      <MoneyCell value={absolute} />
      {absolute === "0.00" ? "" : negative ? " CR" : " DR"}
    </span>
  );
}
export function ReportMetadataPanel({
  metadata,
  sourceNote,
}: {
  metadata: ReportMetadata;
  sourceNote?: string;
}) {
  return (
    <section className="panel" aria-label="Report basis and snapshot">
      <h2>Report basis</h2>
      <p>
        {metadata.company} · {metadata.currency} · Posted accrual accounting
      </p>
      <p>
        {metadata.from} — {metadata.to}, inclusive posting dates ·{" "}
        {metadata.timezone}
      </p>
      <p>
        Generated {metadata.generatedAt} · {metadata.postedEntryCount} company
        posted entries through the report cutoff · Latest included posting{" "}
        {metadata.postingCutoffAt ?? "none"}
      </p>
      <p className="preline">
        Posting snapshot {metadata.databaseSnapshot} · Ledger proof{" "}
        {metadata.ledgerDigest}
      </p>
      <p>
        This live response uses one consistent posted dataset for its rows and
        totals.{" "}
        {sourceNote ??
          "Opening and YEAR_CLOSE entries and dated reversals are included."}{" "}
        Each page request refreshes the current report.
      </p>
    </section>
  );
}
export function FinancialSourceLink({
  journalId,
  type,
  id,
  reference,
}: {
  journalId?: string | null;
  type: string;
  id: string;
  reference: string;
}) {
  const resources: Record<string, string> = {
    MOVEMENT: "movements",
    BILL: "bills",
    INVOICE: "invoices",
    ASSET_MOVEMENT: "asset-movements",
    JOURNAL_DRAFT: "journals",
    COST_ALLOCATION: "cost-allocations",
  };
  const resource = resources[type];
  if (journalId)
    return (
      <Link href={"/finance/posted-sources/" + journalId}>{reference}</Link>
    );
  return resource ? (
    <Link href={"/finance/" + resource + "/" + id}>{reference}</Link>
  ) : (
    <span>
      {reference} ({type})
    </span>
  );
}
