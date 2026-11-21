import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { recognitions } from "@/modules/finance/automation/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { ExportRows } from "@/modules/finance/components/export-view";
import { RecognitionCreateForm } from "@/modules/finance/components/automation-forms";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Recognitions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    d = await financePageData((a) => recognitions(a, q));
  return (
    <section>
      <FinanceNavigation />
      <h1>Deferred revenue recognition</h1>
      <p>
        Move an evidenced delivered service from deferred to earned revenue. No
        new cash or receivable is created.
      </p>
      <section className="panel">
        <h2>Retained recognition records</h2>
        <p>
          {d.total} records · Page {d.page} of {d.pages}
        </p>
        <ExportRows items={d.items} />
        {d.items.map((x) => (
          <p key={x.id}>
            <Link href={`/finance/recognitions/${x.id}`}>
              {x.description}: {x.state}
            </Link>
          </p>
        ))}
        {d.page > 1 && (
          <Link href={`?page=${d.page - 1}`}>Previous recognitions</Link>
        )}
        {d.page < d.pages && (
          <Link href={`?page=${d.page + 1}`}>Next recognitions</Link>
        )}
      </section>
      {d.canManage && (
        <section className="panel">
          <h2>Prepare recognition</h2>
          <RecognitionCreateForm hosted={env.AUTH_PROVIDER === "supabase"} />
        </section>
      )}
    </section>
  );
}
