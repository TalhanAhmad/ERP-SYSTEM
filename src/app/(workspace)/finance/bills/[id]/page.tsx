import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { billDetail } from "@/modules/finance/payables/service";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import { BillForm, BillAction } from "@/modules/finance/components/bill-forms";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Bill({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    data = await financePageData((a) => billDetail(a, id)),
    i = data.item,
    party = (i.state === "POSTED" ? i.partySnapshot : i.party) as {
      name: string;
      legalName: string;
      address?: string | null;
      contactEmail?: string | null;
    },
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.state} · version {i.version} · PKR
      </p>
      <section className="panel" aria-label="Bill preview">
        <h2>Bill preview</h2>
        <h3>{party.legalName}</h3>
        <p>{party.name}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{party.address}</p>
        <p>{party.contactEmail}</p>
        <p>
          Bill date {i.billDate} · Posting date {i.postingDate} · Due{" "}
          {i.dueDate}
        </p>
        <p>{i.description}</p>
        <p>Reference: {i.reference ?? "—"}</p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Bill lines table"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {[
                  "Description",
                  "Quantity",
                  "Unit rate",
                  "Discount",
                  "Treatment",
                  "Total",
                ].map((t) => (
                  <th scope="col" key={t}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {i.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.description}
                    {l.project && " · " + l.project.name}
                  </td>
                  <td>{l.quantity}</td>
                  <td>{l.unitRate}</td>
                  <td>
                    <MoneyCell value={l.discountAmount} />
                  </td>
                  <td>
                    {l.treatment}
                    {l.taxSnapshot && (
                      <small>
                        {" "}
                        · Tax {(l.taxSnapshot as { code: string }).code} ·{" "}
                        {(l.taxSnapshot as { rate: string }).rate}% ·{" "}
                        {(l.taxSnapshot as { mode: string }).mode}
                      </small>
                    )}
                  </td>
                  <td>
                    <MoneyCell value={l.totalAmount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Gross <MoneyCell value={i.lineAmount} /> · Discount{" "}
          <MoneyCell value={i.discountAmount} /> · Tax{" "}
          <MoneyCell value={i.taxAmount} /> · Total{" "}
          <MoneyCell value={i.totalAmount} />
        </p>
      </section>
      {i.state === "DRAFT" && (
        <>
          <section className="panel" aria-label="Edit bill draft">
            <h2>Edit bill draft</h2>
            <BillForm key={i.version} item={i} hosted={hosted} />
          </section>
          <section className="panel" aria-label="Post bill">
            <h2>Post bill</h2>
            <p>Posting makes the reviewed bill permanent.</p>
            <BillAction item={i} action="POST" hosted={hosted} />
          </section>
          <section className="panel" aria-label="Void bill draft">
            <h2>Void bill draft</h2>
            <BillAction item={i} action="VOID" hosted={hosted} />
          </section>
        </>
      )}
      {i.state === "POSTED" && (
        <section className="panel" aria-label="Bill settlements">
          <h2>Bill settlements</h2>
          <p>
            Outstanding payable: <MoneyCell value={data.payableBalance} />
          </p>
          {i.payableEvents.map((e) => (
            <p key={e.id}>
              {e.effectiveDate} · {i.number} · {e.kind} ·{" "}
              <MoneyCell value={e.amount} />
            </p>
          ))}
        </section>
      )}
      {i.entry && (
        <p>
          Posted journal: {i.entry.reference} · {i.entry.postingDate}
        </p>
      )}
      <SetupHistory events={data.history} />
    </section>
  );
}
