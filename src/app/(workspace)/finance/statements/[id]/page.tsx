import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { statementBatch } from "@/modules/finance/treasury/statements/service";
import { StatementVoidForm } from "@/modules/finance/components/statement-forms";
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
    d = await financePageData((a) => statementBatch(a, id, q)),
    i = d.item,
    mapping = i.mapping as {
      mode: string;
      dateFormat: string;
      dateColumn: number;
      amountColumn?: number;
      positiveMeans?: string;
      debitColumn?: number;
      creditColumn?: number;
      descriptionColumn: number | null;
      referenceColumn: number | null;
      skipRows: number;
    };
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.state} · version {i.version}
      </p>
      <section className="panel" aria-label="Retained statement evidence">
        <h2>{i.cashAccount.name}</h2>
        <p className="preline">
          {i.fileName} · {i.byteSize} bytes · {i.rowCount} records · PKR
        </p>
        <p>
          Value dates {i.startDate} through {i.endDate}
        </p>
        <p>
          Original cash mapping {i.glAccount.code} · {i.glAccount.name}
        </p>
        <p>
          Opening statement balance <MoneyCell value={i.openingBalance} /> ·
          Money in <MoneyCell value={i.receipts} /> · Money out{" "}
          <MoneyCell value={i.payments} /> · Closing statement balance{" "}
          <MoneyCell value={i.closingBalance} />
        </p>
        <p>
          {i.duplicateCount} potential duplicate records explicitly reviewed.
          {i.duplicateReview && " Review: " + i.duplicateReview}
        </p>
        <p>
          Imported by {i.createdBy.displayName}. Bank evidence is separate from
          posted cash entries and reconciliation.
        </p>
        <details>
          <summary>Source integrity and column mapping</summary>
          <p className="preline">
            File SHA-256: <code>{i.sha256}</code>
          </p>
          <p>
            Date column {mapping.dateColumn + 1} · Format {mapping.dateFormat}
          </p>
          <p>
            {mapping.mode === "SIGNED"
              ? "Signed amount column " +
                ((mapping.amountColumn ?? 0) + 1) +
                "; positive means " +
                (mapping.positiveMeans === "RECEIPT" ? "money in" : "money out")
              : "Money-out column " +
                ((mapping.debitColumn ?? 0) + 1) +
                "; money-in column " +
                ((mapping.creditColumn ?? 0) + 1)}
          </p>
          <p>
            {mapping.skipRows} nonempty records precede the header. Record
            references count nonempty CSV records; quoted newlines stay inside
            the same record.
          </p>
        </details>
        {i.replaces && (
          <Link href={"/finance/statements/" + i.replaces.id}>
            Retained original {i.replaces.number}
          </Link>
        )}
        {i.replacedBy && (
          <Link href={"/finance/statements/" + i.replacedBy.id}>
            Reviewed replacement {i.replacedBy.number}
          </Link>
        )}
        {i.state === "VOIDED" && !i.replacedBy && (
          <Link href={"/finance/statements/import?replacesId=" + i.id}>
            Create reviewed replacement
          </Link>
        )}
      </section>
      <section className="panel">
        <h2>Imported bank records</h2>
        <div
          className="table-wrap"
          role="region"
          aria-label="Imported bank records"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>CSV record</th>
                <th>Bank value date</th>
                <th>Direction</th>
                <th>Amount (PKR)</th>
                <th>Description / bank reference</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.sourceRow}</td>
                  <td>{l.valueDate}</td>
                  <td>
                    {l.direction === "RECEIPT" ? "Money in" : "Money out"}
                  </td>
                  <td>
                    <MoneyCell value={l.amount} />
                  </td>
                  <td>
                    {l.description} · {l.bankReference}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Page {d.page} of {d.pages}
        </p>
        <div className="form-actions">
          {d.page > 1 && (
            <Link href={"?page=" + (d.page - 1)}>Previous bank records</Link>
          )}
          {d.page < d.pages && (
            <Link href={"?page=" + (d.page + 1)}>Next bank records</Link>
          )}
        </div>
      </section>
      {i.state === "IMPORTED" && (
        <section className="panel" aria-label="Void statement source">
          <h2>Void this imported evidence</h2>
          <p>
            Keep the original file and records while reviewing a corrected
            replacement. Voiding does not reverse money or delete history.
          </p>
          <StatementVoidForm
            item={i}
            hosted={env.AUTH_PROVIDER === "supabase"}
          />
        </section>
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
