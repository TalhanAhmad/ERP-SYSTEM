import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { fiscalYears } from "@/modules/finance/year-closing/service";
import { yearQuerySchema } from "@/modules/finance/year-closing/schemas";
import { FiscalYearForm } from "@/modules/finance/components/year-closing-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function FiscalYears({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    parsed = yearQuerySchema.safeParse(q),
    d = await financePageData((a) =>
      fiscalYears(a, parsed.success ? parsed.data : {}),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>Fiscal years</h1>
      <p>
        Review annual profit or loss, transfer remaining income and expense
        balances to retained earnings, and retain the original statements.
      </p>
      {!parsed.success && (
        <p role="alert">Invalid page. Showing the first page.</p>
      )}
      {d.canManage && (
        <section className="panel">
          <h2>Configure reviewed fiscal year</h2>
          <FiscalYearForm hosted={env.AUTH_PROVIDER === "supabase"} />
        </section>
      )}
      <section className="panel">
        <h2>Fiscal-year register</h2>
        <p>
          {d.total} years · Page {d.page} of {d.pages}
        </p>
        {d.items.map((y) => (
          <p key={y.id}>
            <Link href={`/finance/fiscal-years/${y.id}`}>{y.name}</Link> ·{" "}
            {y.startDate}–{y.endDate} · {y.state}
          </p>
        ))}
        {!d.total && <p>No fiscal years configured.</p>}
        {d.page > 1 && <Link href={`?page=${d.page - 1}`}>Previous years</Link>}
        {d.page < d.pages && (
          <Link href={`?page=${d.page + 1}`}>Next years</Link>
        )}
      </section>
    </section>
  );
}
