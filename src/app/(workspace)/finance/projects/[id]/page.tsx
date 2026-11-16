import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  projectFinanceCandidate,
  projectFinanceDetail,
} from "@/modules/finance/projects/service";
import {
  CommercialProfileForm,
  CommercialProfileAction,
} from "@/modules/finance/components/commercial-forms";
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
    c = await financePageData((a) => projectFinanceCandidate(a, id)),
    hosted = env.AUTH_PROVIDER === "supabase";
  if (!c.registered)
    return (
      <section>
        <FinanceNavigation />
        <Link href={"/finance/budgets?projectId=" + id}>Project budgets</Link>
        <Link href={"/finance/forecasts?projectId=" + id}>
          Project cash forecasts
        </Link>
        <h1>{c.name} · Commercial profile</h1>
        <Link href={"/finance/project-results/" + id}>
          Project financial results
        </Link>
        <section className="panel">
          <h2>Create commercial draft</h2>
          <CommercialProfileForm
            hosted={hosted}
            projectId={id}
            projectName={c.name}
          />
        </section>
      </section>
    );
  const d = await financePageData((a) => projectFinanceDetail(a, id)),
    i = d.item;
  return (
    <section>
      <FinanceNavigation />
      <Link href={"/finance/budgets?projectId=" + id}>Project budgets</Link>
      <Link href={"/finance/forecasts?projectId=" + id}>
        Project cash forecasts
      </Link>
      <h1>{i.project.name} · Commercial profile</h1>
      <p>
        {i.state} · version {i.version} · {i.billingModel.replaceAll("_", " ")}
      </p>
      <Link href={"/projects/" + i.projectId}>Workspace project</Link>
      <Link href={"/finance/project-results/" + id}>
        Project financial results
      </Link>
      <section className="panel" aria-label="Commercial agreement">
        <h2>Commercial agreement</h2>
        <p>Client {i.client.name}</p>
        <p>
          Original agreement <MoneyCell value={i.originalContract} /> · Approved
          increases <MoneyCell value={d.totals.approvedIncrease} /> · Approved
          decreases <MoneyCell value={d.totals.approvedDecrease} />
        </p>
        <p>
          Current contract value <MoneyCell value={d.totals.contractValue} />
        </p>
        <p>{i.terms}</p>
        <p>Evidence: {i.evidence}</p>
        {i.signedDate && (
          <p>
            Signed {i.signedDate} · Approval: {i.approvalEvidence}
          </p>
        )}
        <p>
          Confirmed billing plans{" "}
          <MoneyCell value={d.totals.confirmedMilestones} />
        </p>
        {d.totals.overplanned && (
          <p role="status">
            Confirmed milestone plans exceed current contract value. Review the
            commercial plan.
          </p>
        )}
        <p>
          Agreements and billing plans create no journal. Recognize delivery and
          settlement through reviewed invoices and finance actions.
        </p>
      </section>
      {i.state === "DRAFT" && (
        <section className="panel">
          <h2>Edit commercial draft</h2>
          <CommercialProfileForm item={i} hosted={hosted} key={i.version} />
        </section>
      )}
      {(i.state === "DRAFT"
        ? (["ACTIVATE", "CANCEL"] as const)
        : i.state === "ACTIVE"
          ? (["CLOSE"] as const)
          : (["REOPEN"] as const)
      ).map((action) => (
        <section
          className="panel"
          key={action}
          aria-label={action + " commercial profile"}
        >
          <h2>
            {action === "ACTIVATE"
              ? "Confirm signed agreement"
              : action === "CLOSE"
                ? "Close commercial planning"
                : action === "CANCEL"
                  ? "Cancel draft profile"
                  : "Reopen commercial profile"}
          </h2>
          <CommercialProfileAction item={i} hosted={hosted} action={action} />
        </section>
      ))}
      <section className="panel" aria-label="Commercial variations">
        <h2>Signed variations</h2>
        {i.state === "ACTIVE" && (
          <Link
            href={"/finance/project-variations/new?projectId=" + i.projectId}
          >
            Create variation draft
          </Link>
        )}
        <p>{i._count.variations} retained records</p>
        <ul>
          {i.variations.map((v) => (
            <li key={v.id}>
              <Link href={"/finance/project-variations/" + v.id}>
                {v.number}
              </Link>{" "}
              · {v.direction} · <MoneyCell value={v.amount} /> · {v.state}
            </li>
          ))}
        </ul>
        <Link href={"/finance/project-variations?projectId=" + i.projectId}>
          View all variations
        </Link>
      </section>
      <section className="panel" aria-label="Commercial billing plans">
        <h2>Billing milestones</h2>
        {i.state === "ACTIVE" && (
          <Link
            href={"/finance/billing-milestones/new?projectId=" + i.projectId}
          >
            Create billing milestone draft
          </Link>
        )}
        <p>{i._count.milestones} retained records</p>
        <ul>
          {i.milestones.map((m) => (
            <li key={m.id}>
              <Link href={"/finance/billing-milestones/" + m.id}>
                {m.number}
              </Link>{" "}
              · {m.description} · <MoneyCell value={m.amount} /> · {m.state}
            </li>
          ))}
        </ul>
        <Link href={"/finance/billing-milestones?projectId=" + i.projectId}>
          View all billing milestones
        </Link>
      </section>
      <SetupHistory events={d.history} />
    </section>
  );
}
