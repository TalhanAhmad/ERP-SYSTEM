import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { openingCreditReviews } from "@/modules/finance/automation/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { ExportRows } from "@/modules/finance/components/export-view";
export const dynamic = "force-dynamic";
export default async function Reviews({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    d = await financePageData((a) => openingCreditReviews(a, q));
  return (
    <section>
      <FinanceNavigation />
      <h1>Opening credit classification reviews</h1>
      <p>
        Credits against imported unpaid invoices or bills need the Finance
        Owner’s approval of their exact draft and opening-equity offset. Open
        the customer or supplier credit draft to review its classification.
        Original cutover clearing and current sales/costs remain unchanged.
      </p>
      <section className="panel">
        <h2>Retained owner reviews</h2>
        <p>
          {d.total} reviews · Page {d.page} of {d.pages}
        </p>
        <ExportRows items={d.items} />
        {d.items.map((x) => (
          <p key={x.id}>
            <Link
              href={`/finance/${x.customerDocumentId ? "customer-credits" : "supplier-credits"}/${x.customerDocumentId ?? x.supplierDocumentId}`}
            >
              Open reviewed credit source
            </Link>
          </p>
        ))}
        {d.page > 1 && (
          <Link href={`?page=${d.page - 1}`}>Previous reviews</Link>
        )}
        {d.page < d.pages && (
          <Link href={`?page=${d.page + 1}`}>Next reviews</Link>
        )}
      </section>
    </section>
  );
}
