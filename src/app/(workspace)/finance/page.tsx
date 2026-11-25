import Link from "next/link";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { financeSections } from "@/modules/finance/components/navigation-links";
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
      <FinanceNavigation />
      <p className="eyebrow">FINANCE · PKR</p>
      <h1>Finance overview</h1>
      <p>Find daily transactions, financial reports and accounting settings.</p>
      <div className="finance-section-grid">
        {financeSections.map((section) => (
          <section
            className="panel finance-section-card"
            key={section.label}
            aria-label={section.label}
          >
            <h2>{section.label}</h2>
            <p>{section.description}</p>
            <ul>
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} prefetch={false}>
                    {link.label}
                    <span aria-hidden="true"> →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Link href="/dashboard" className="button secondary">
        Back to workspace
      </Link>
    </section>
  );
}
