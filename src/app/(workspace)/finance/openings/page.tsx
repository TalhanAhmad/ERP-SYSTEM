import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { openingBatches } from "@/modules/finance/opening/service";
import { OpeningUploadForm } from "@/modules/finance/components/opening-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { openingQuery } from "@/modules/finance/opening/schemas";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Openings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    parsed = openingQuery.safeParse(q),
    d = await financePageData((a) =>
      openingBatches(a, parsed.success ? parsed.data : {}),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>Opening balances</h1>
      <p>
        Initialize reviewed legacy balances and open items once, before any
        financial posting.
      </p>
      <p>
        <Link href="/finance/openings/format">
          Opening file format and preparation
        </Link>
      </p>
      {!parsed.success && (
        <p role="alert">Invalid page. Showing the first page.</p>
      )}
      {d.canManage && (
        <section className="panel">
          <h2>Stage opening file</h2>
          <OpeningUploadForm hosted={env.AUTH_PROVIDER === "supabase"} />
        </section>
      )}
      <section className="panel">
        <h2>Retained opening imports</h2>
        <p>
          {d.total} imports · Page {d.page} of {d.pages}
        </p>
        {d.items.map((b) => (
          <p key={b.id}>
            <Link href={`/finance/openings/${b.id}`}>{b.name}</Link> ·{" "}
            {b.cutoverDate} · {b.state}
          </p>
        ))}
        {!d.total && <p>No opening file has been imported.</p>}
        {d.page > 1 && (
          <Link href={`?page=${d.page - 1}`}>Previous imports</Link>
        )}
        {d.page < d.pages && (
          <Link href={`?page=${d.page + 1}`}>Next imports</Link>
        )}
      </section>
    </section>
  );
}
