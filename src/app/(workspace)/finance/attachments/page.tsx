import Link from "next/link";
import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  files,
  filesQuerySchema,
} from "@/modules/finance/documents/files/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { EvidenceActions } from "@/modules/finance/components/evidence-files";
export const dynamic = "force-dynamic";
export default async function Evidence({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    data = await financePageData((a) => {
      const p = filesQuerySchema.safeParse(raw);
      return files(a, p.success ? p.data : {});
    }),
    hosted = env.AUTH_PROVIDER === "supabase";
  const href = (page: number) =>
    "?" +
    new URLSearchParams(
      Object.fromEntries(
        Object.entries({ ...data.filters, page })
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>Private evidence</h1>
      <p>
        Financial evidence is private. Add files from the related invoice, bill
        or payment. Quarantined files stay unavailable until verified by the
        approved scanner.
      </p>
      <form className="form-grid" method="get">
        <label>
          Search evidence
          <input name="q" defaultValue={data.filters.q} />
        </label>
        <label>
          Evidence state
          <select name="state" defaultValue={data.filters.state}>
            {[
              "ALL",
              "ACTIVE",
              "RESERVED",
              "QUARANTINED",
              "CLEAN",
              "REJECTED",
              "REMOVED",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button>Filter evidence</button>
      </form>
      <p>
        {data.total} files · page {data.page} of {data.pages}
      </p>
      {data.items.map((f) => {
        const source = f.invoiceId
          ? ["invoices", f.invoiceId]
          : f.billId
            ? ["bills", f.billId]
            : f.customerDocumentId
              ? [
                  (
                    {
                      RECEIPT: "receipts",
                      ADVANCE_APPLICATION: "advance-applications",
                      CUSTOMER_CREDIT: "customer-credits",
                      CUSTOMER_REFUND: "customer-refunds",
                      UNALLOCATION: "receipt-unallocations",
                    } as Record<string, string>
                  )[f.customerDocument?.kind ?? ""] ?? "receipts",
                  f.customerDocumentId,
                ]
              : f.supplierDocumentId
                ? [
                    (
                      {
                        PAYMENT: "supplier-payments",
                        ADVANCE_APPLICATION: "supplier-applications",
                        SUPPLIER_CREDIT: "supplier-credits",
                        SUPPLIER_REFUND: "supplier-refunds",
                        UNALLOCATION: "supplier-releases",
                      } as Record<string, string>
                    )[f.supplierDocument?.kind ?? ""] ?? "supplier-payments",
                    f.supplierDocumentId,
                  ]
                : ["journals", f.journalDraftId];
        return (
          <section className="panel" key={f.id}>
            <h2>{f.fileName}</h2>
            <p>
              {f.byteSize.toLocaleString("en-PK")} bytes ·{" "}
              {f.uploader.displayName}
            </p>
            {source && (
              <Link href={"/finance/" + source[0] + "/" + source[1]}>
                Open source document
              </Link>
            )}
            <EvidenceActions file={f} hosted={hosted} />
          </section>
        );
      })}
      <div className="form-actions">
        {data.page > 1 && (
          <Link href={href(data.page - 1)}>Previous evidence</Link>
        )}
        {data.page < data.pages && (
          <Link href={href(data.page + 1)}>Next evidence</Link>
        )}
      </div>
    </section>
  );
}
