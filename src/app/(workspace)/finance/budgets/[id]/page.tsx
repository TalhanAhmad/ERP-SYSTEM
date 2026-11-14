import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { budgetDetail } from "@/modules/finance/planning/service";
import {
  BudgetForm,
  BudgetAction,
} from "@/modules/finance/components/planning-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => budgetDetail(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.month} · {i.project?.name ?? "Shared company"} · Revision{" "}
        {i.revision} · {i.state} · version {i.version}
      </p>
      <section className="panel" aria-label="Monthly budget plan">
        <h2>Monthly budget plan</h2>
        <p>{i.description}</p>
        <p>Planning evidence: {i.evidence}</p>
        <p>
          Total planned cost <MoneyCell value={i.total} />
        </p>
        {i.approvalEvidence && <p>Approval evidence: {i.approvalEvidence}</p>}
        <div
          className="table-wrap"
          role="region"
          aria-label="Budget expense accounts"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Expense account</th>
                <th>Planned cost (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {i.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.account.code} · {l.account.name}
                  </td>
                  <td>
                    <MoneyCell value={l.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link
          href={
            "/finance/budget-variance?" +
            new URLSearchParams({
              month: i.month,
              projectId: i.projectId ?? "SHARED",
            })
          }
        >
          Compare approved budget with actuals
        </Link>
        {i.previous && (
          <Link href={"/finance/budgets/" + i.previous.id}>
            Previous revision {i.previous.number}
          </Link>
        )}
        {i.revisions.map((r) => (
          <p key={r.id}>
            <Link href={"/finance/budgets/" + r.id}>
              Revision {r.revision} · {r.number} · {r.state}
            </Link>
          </p>
        ))}
        {i.state === "APPROVED" && (
          <Link href={"/finance/budgets/new?previousId=" + i.id}>
            Start budget revision
          </Link>
        )}
        <p>
          Only the current approved plan is used for variance. Required
          accounting recognition is allowed even when a budget is exceeded.
        </p>
      </section>
      {i.state === "DRAFT" && (
        <>
          <section className="panel">
            <h2>Edit monthly budget draft</h2>
            <BudgetForm key={i.version} item={i} hosted={hosted} />
          </section>
          {(["APPROVE", "VOID"] as const).map((action) => (
            <section
              className="panel"
              aria-label={action + " budget"}
              key={action}
            >
              <h2>
                {action === "APPROVE" ? "Approve budget" : "Void budget draft"}
              </h2>
              <BudgetAction item={i} hosted={hosted} action={action} />
            </section>
          ))}
        </>
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
