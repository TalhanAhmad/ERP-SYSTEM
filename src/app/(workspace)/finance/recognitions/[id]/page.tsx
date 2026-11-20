import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { recognition } from "@/modules/finance/automation/service";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { RecognitionChange } from "@/modules/finance/components/automation-forms";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Recognition({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => recognition(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>Service recognition</h1>
      <section className="panel">
        <h2>{i.description}</h2>
        <p>
          {i.state} · Posting date {i.postingDate.slice(0, 10)} · Version{" "}
          {i.version}
        </p>
        <p>
          Recognized portion: <MoneyCell value={i.amount} />
        </p>
        <p>Approval evidence: {i.evidence}</p>
        <p>
          Remaining eligible deferred balance from this date:{" "}
          <MoneyCell value={d.remainingDeferred} />. Later effective events
          reserve capacity.
        </p>
        {i.journalId && (
          <p>
            <Link href={`/finance/posted-sources/${i.journalId}`}>
              Original recognition journal
            </Link>
          </p>
        )}
        {i.reversalJournalId && (
          <p>
            <Link href={`/finance/posted-sources/${i.reversalJournalId}`}>
              Dated opposite journal
            </Link>
          </p>
        )}
      </section>
      {d.canManage &&
        i.state === "DRAFT" &&
        (["POST", "VOID"] as const).map((action) => (
          <section className="panel" key={action}>
            <h2>
              {action === "POST" ? "Review and post" : "Retain unused draft"}
            </h2>
            <RecognitionChange hosted={hosted} action={action} item={i} />
          </section>
        ))}
      {d.canManage && i.state === "POSTED" && (
        <section className="panel">
          <h2>Traceable correction</h2>
          <RecognitionChange hosted={hosted} action="REVERSE" item={i} />
        </section>
      )}
    </section>
  );
}
