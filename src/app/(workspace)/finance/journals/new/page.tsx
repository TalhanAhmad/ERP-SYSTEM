import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { journalProjects } from "@/modules/finance/ledger/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { JournalForm } from "@/modules/finance/components/journal-forms";
export const dynamic = "force-dynamic";
export default async function NewJournal() {
  const projects = await financePageData(journalProjects);
  return (
    <section>
      <FinanceNavigation />
      <h1>New journal draft</h1>
      <section className="panel" aria-label="Create journal draft">
        <JournalForm
          hosted={env.AUTH_PROVIDER === "supabase"}
          projects={projects}
        />
      </section>
    </section>
  );
}
