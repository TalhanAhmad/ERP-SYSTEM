import Link from "next/link";
import { notFound } from "next/navigation";
import { context } from "@/server/context";
import { AppError } from "@/server/errors";
import {
  financeStatus,
  requireFinanceEnabled,
} from "@/modules/finance/access/policy";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  try {
    requireFinanceEnabled();
    await financeStatus(await context());
  } catch (error) {
    if (error instanceof AppError && [403, 404].includes(error.status))
      notFound();
    throw error;
  }
  return (
    <section>
      <p className="eyebrow">FINANCE · PKR</p>
      <h1>Finance setup</h1>
      <div className="panel">
        <h2>Ledger and accounting setup</h2>
        <p>
          <Link href="/finance/journals">Journal register</Link> ·{" "}
          <Link href="/finance/accounts">Chart of accounts</Link> ·{" "}
          <Link href="/finance/periods">Accounting periods</Link>
        </p>
        <p>
          Review invoices, record client receipts, apply held funds and manage
          credit notes or refunds.
        </p>
        <p>
          <Link href="/finance/invoices">Invoices</Link> ·{" "}
          <Link href="/finance/receipts">Client receipts</Link> ·{" "}
          <Link href="/finance/advance-applications">Apply client funds</Link> ·{" "}
          <Link href="/finance/customer-credits">Credit notes</Link> ·{" "}
          <Link href="/finance/customer-refunds">Client refunds</Link>
        </p>
        <Link href="/dashboard" className="button secondary">
          Back to workspace
        </Link>
        <p>
          <Link href="/finance/access">Finance access and ownership</Link>
        </p>
      </div>
    </section>
  );
}
