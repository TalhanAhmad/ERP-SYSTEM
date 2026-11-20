import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  openingDetail,
  openingPreview,
  openingLines,
} from "@/modules/finance/opening/service";
import {
  OpeningPostForm,
  OpeningVoidForm,
} from "@/modules/finance/components/opening-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import {
  ExportRows,
  ExportValues,
} from "@/modules/finance/components/export-view";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Opening({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params,
    q = await searchParams,
    d = await financePageData(async (a) => {
      const batch = await openingDetail(a, id);
      return {
        batch,
        preview: batch.state === "DRAFT" ? await openingPreview(a, id) : null,
        lines: await openingLines(a, id, q),
      };
    }),
    b = d.batch,
    p = d.preview,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{b.name}</h1>
      <p>
        Cutover {b.cutoverDate} · {b.state}
      </p>
      <p>{b.evidence}</p>
      <p className="preline">Original source proof: {b.sourceHash}</p>
      <p>
        <a href={`/api/v1/finance/openings/${id}/source`}>
          Download retained opening file
        </a>
      </p>
      {p && (
        <section className="panel">
          <h2>
            {p.ready
              ? "Opening checks passed — owner approval required"
              : "Resolve opening import checks"}
          </h2>
          <ul>
            <li>
              Trial balance: {p.balanced ? "Balanced" : "Unbalanced"} · Debits
              PKR {p.debits} · Credits PKR {p.credits}
            </li>
            <li>{p.mappingIssueCount} source mapping issues.</li>
            <li>
              Existing ledger:{" "}
              {p.ledgerEmpty
                ? "Empty"
                : "Posting already exists; opening unavailable"}
            </li>
            <li>
              Cutover matches first open period:{" "}
              {p.cutoverIsFirstOpenDate ? "Yes" : "Review period setup"}
            </li>
          </ul>
          <ExportRows items={p.controls} />
          {p.issues.length > 0 && <ExportRows items={p.issues} />}
        </section>
      )}
      {b.proof && (
        <section className="panel">
          <h2>Posted opening reconciliation proof</h2>
          <p>Clearing balance: PKR {b.proof.clearingBalance}</p>
          <p>
            {b.journalCount} original opening journals. Original approval:{" "}
            {b.reviewEvidence}
          </p>
          <ExportRows items={b.proof.accounts} />
          <details>
            <summary>Original proof and journal digest</summary>
            <ExportValues value={b.proof} />
          </details>
        </section>
      )}
      <section className="panel">
        <h2>Retained source rows</h2>
        <p>
          {d.lines.total} rows · Page {d.lines.page} of {d.lines.pages}
        </p>
        <div className="form-actions">
          <Link href="?kind=ALL">All rows</Link>
          <Link href="?kind=TB">Trial balance</Link>
          <Link href="?kind=ITEMS">Detailed positions</Link>
        </div>
        <ExportRows items={d.lines.items} />
        {d.lines.items
          .filter((x) => x.journalId)
          .map((x) => (
            <p key={x.id}>
              <Link href={`/finance/posted-sources/${x.journalId}`}>
                {x.reference}: original posted journal
              </Link>
            </p>
          ))}
        {d.lines.page > 1 && (
          <Link href={`?kind=${q.kind ?? "ALL"}&page=${d.lines.page - 1}`}>
            Previous source rows
          </Link>
        )}
        {d.lines.page < d.lines.pages && (
          <Link href={`?kind=${q.kind ?? "ALL"}&page=${d.lines.page + 1}`}>
            Next source rows
          </Link>
        )}
      </section>
      {b.canManage && p && (
        <>
          <section className="panel">
            <h2>Owner cutover approval</h2>
            <OpeningPostForm
              key={p.basisHash}
              value={b}
              preview={p}
              hosted={hosted}
            />
          </section>
          <section className="panel">
            <h2>Correct an unposted file</h2>
            <OpeningVoidForm value={b} hosted={hosted} />
          </section>
        </>
      )}
    </section>
  );
}
