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
        <h2>Accounting setup is in progress</h2>
        <p>
          Transactions and reports will be available after accounting setup and
          verification are complete.
        </p>
        <Link href="/dashboard" className="button secondary">
          Back to workspace
        </Link>
      </div>
    </section>
  );
}
