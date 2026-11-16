import { financePageData } from "@/modules/finance/accounting/page-data";
import { financeStatus } from "@/modules/finance/access/policy";
import { statementBatch } from "@/modules/finance/treasury/statements/service";
import { StatementImportForm } from "@/modules/finance/components/statement-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Import({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  await financePageData((a) => financeStatus(a));
  const source = q.replacesId
    ? await financePageData((a) => statementBatch(a, q.replacesId!))
    : null;
  return (
    <section>
      <FinanceNavigation />
      <h1>
        {source ? "Reviewed statement replacement" : "Import a bank statement"}
      </h1>
      {!source ||
      (source.item.state === "VOIDED" && !source.item.replacedBy) ? (
        <StatementImportForm
          hosted={env.AUTH_PROVIDER === "supabase"}
          replacement={
            source
              ? {
                  id: source.item.id,
                  number: source.item.number,
                  cashAccountId: source.item.cashAccountId,
                  cashAccountName: source.item.cashAccount.name,
                }
              : undefined
          }
        />
      ) : (
        <p>Open the latest voided source before starting a corrected import.</p>
      )}
    </section>
  );
}
