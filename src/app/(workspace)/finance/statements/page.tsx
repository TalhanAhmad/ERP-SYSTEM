import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { statementBatches } from "@/modules/finance/treasury/statements/service";
import { statementBatchQuerySchema } from "@/modules/finance/treasury/statements/schemas";
import { FinanceRegister } from "@/modules/finance/components/finance-register";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const raw = await searchParams,
    d = await financePageData((a) => {
      const q = statementBatchQuerySchema.safeParse(raw);
      return statementBatches(a, q.success ? q.data : {});
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Bank statement evidence</h1>
      <Link href="/finance/bank-matches">Review bank matching</Link>
      <Link href="/finance/statements/import">Import a bank statement</Link>
      <p>
        Retained CSV evidence with reviewed columns, value dates and
        opening/closing totals. Importing a statement does not record money or
        automatically match transactions.
      </p>
      <FinanceRegister
        drawer={false}
        label="Statement"
        columns={[
          "Bank / file",
          "Value-date range",
          "Records",
          "Closing statement balance (PKR)",
          "State",
        ]}
        rows={d.items.map((b) => ({
          id: b.id,
          name: b.number,
          href: "/finance/statements/" + b.id,
          endpoint: "/api/v1/finance/statements/" + b.id,
          cells: [
            b.cashAccount.name + " · " + b.upload.fileName,
            b.startDate + " — " + b.endDate,
            String(b.rowCount),
            <MoneyCell key="balance" value={b.closingBalance} />,
            b.state,
          ],
        }))}
        total={d.total}
        page={d.page}
        pages={d.pages}
        href={(page) =>
          "?" + new URLSearchParams({ ...d.filters, page: String(page) })
        }
      >
        <form method="get" className="form-grid">
          {d.filters.cashAccountId && (
            <input
              type="hidden"
              name="cashAccountId"
              value={d.filters.cashAccountId}
            />
          )}
          <label>
            Search statement sources
            <input name="q" maxLength={100} defaultValue={d.filters.q} />
          </label>
          <label>
            Statement state
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "IMPORTED", "VOIDED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Filter statements</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
