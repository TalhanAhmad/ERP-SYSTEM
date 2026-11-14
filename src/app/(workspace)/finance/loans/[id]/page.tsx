import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { loanDetail } from "@/modules/finance/funding/loans/service";
import {
  LoanForm,
  LoanArchiveForm,
} from "@/modules/finance/components/loan-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { MoneyCell } from "@/modules/finance/components/money-cell";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Loan({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => loanDetail(a, id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase",
    plan = i.manualSchedule as {
      dueDate: string;
      principal: string;
      interest: string;
    }[];
  return (
    <section>
      <FinanceNavigation />
      <h1>
        {i.number} · {i.name}
      </h1>
      <p>
        {i.direction} · {i.party.name} · {i.active ? "ACTIVE" : "ARCHIVED"} ·
        version {i.version}
      </p>
      <section className="panel" aria-label="Loan terms">
        <p>Agreement {i.agreement}</p>
        <p>
          Start {i.startDate} · Maturity {i.maturityDate} · Agreed limit{" "}
          <MoneyCell value={i.agreedPrincipal} />
        </p>
        <p>
          Reference annual rate: {i.annualRate ?? "Not specified"} · Manual
          reviewed accruals only
        </p>
        <p>
          Outstanding principal <MoneyCell value={d.principal} /> · Accrued
          interest <MoneyCell value={d.interest} />
        </p>
        <p>
          Principal control: {i.principalAccount.code} · Interest control:{" "}
          {i.interestAccount.code} · Interest result:{" "}
          {i.interestResultAccount.code}
        </p>
      </section>
      {i.active && (
        <Link
          href={"/finance/loans/" + id + "/movements/new"}
          className="button primary"
        >
          Record loan movement
        </Link>
      )}
      {!i.usedAt && (
        <section className="panel">
          <h2>Edit unposted agreement</h2>
          <LoanForm key={i.version} item={i} hosted={hosted} />
        </section>
      )}
      <section className="panel">
        <h2>Manual repayment plan</h2>
        <p>These planned amounts create no journal, accrual or payment.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Due</th>
                <th>Principal</th>
                <th>Interest</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((r, n) => (
                <tr key={n}>
                  <td>{r.dueDate}</td>
                  <td>
                    <MoneyCell value={r.principal} />
                  </td>
                  <td>
                    <MoneyCell value={r.interest} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>Latest movements</h2>
        <p>
          Latest25 sources.{" "}
          <Link href="/finance/loans">Return to loan register</Link>
        </p>
        {d.movements.map((m) => (
          <p key={m.id}>
            <Link href={"/finance/movements/" + m.id}>{m.number}</Link> ·{" "}
            {m.kind.replaceAll("_", " ")} · {m.state} · {m.postingDate} ·{" "}
            <MoneyCell value={m.amount} />
          </p>
        ))}
      </section>
      <section className="panel">
        <h2>{i.active ? "Archive settled loan" : "Reactivate loan"}</h2>
        <LoanArchiveForm item={i} hosted={hosted} />
      </section>
      <SetupHistory events={d.history} />
    </section>
  );
}
