import Link from "next/link";
import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { invoiceDetail } from "@/modules/finance/receivables/service";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
import {
  InvoiceForm,
  InvoiceAction,
} from "@/modules/finance/components/invoice-forms";
import { MoneyCell } from "@/modules/finance/components/money-cell";
export const dynamic = "force-dynamic";
export default async function Invoice({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    data = await financePageData((a) => invoiceDetail(a, id)),
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
      <section className="panel" aria-label="Invoice preview">
        <h2>Invoice preview</h2>
        <h3>{party.legalName}</h3>
        <p>{party.name}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{party.address}</p>
        <p>{party.contactEmail}</p>
        <p>
          Invoice date {i.invoiceDate} · Posting date {i.postingDate} · Due{" "}
          {i.dueDate}
        </p>
        <p>{i.description}</p>
        <p>Reference: {i.reference ?? "—"}</p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Invoice lines table"
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
                    {l.recognition}
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
        {i.state === "POSTED" && (
          <a
            className="button"
            href={"/api/v1/finance/invoices/" + i.id + "/pdf"}
          >
            Download private invoice PDF
          </a>
        )}
      </section>
      {i.state === "DRAFT" && (
        <>
          <section className="panel" aria-label="Edit invoice draft">
            <h2>Edit invoice draft</h2>
            <InvoiceForm key={i.version} item={i} hosted={hosted} />
          </section>
          <section className="panel" aria-label="Post invoice">
            <h2>Post invoice</h2>
            <p>Posting makes the reviewed invoice permanent.</p>
            <InvoiceAction item={i} action="POST" hosted={hosted} />
          </section>
          <section className="panel" aria-label="Void invoice draft">
            <h2>Void invoice draft</h2>
            <InvoiceAction item={i} action="VOID" hosted={hosted} />
          </section>
        </>
      )}
      {i.state === "POSTED" && (
        <section className="panel" aria-label="Invoice settlements">
          <h2>Invoice settlements</h2>
          <p>
            Outstanding receivable: <MoneyCell value={data.receivableBalance} />
          </p>
          {i.receivableEvents.map((e) => (
            <p key={e.id}>
              {e.effectiveDate} · {e.customerDocument?.number ?? i.number} ·{" "}
              {e.kind} · <MoneyCell value={e.amount} />
            </p>
          ))}
        </section>
      )}
      {!!data.credits.length && (
        <section className="panel" aria-label="Invoice credit notes">
          <h2>Credit notes</h2>
          {data.credits.map((c) => (
            <p key={c.id}>
              <Link href={"/finance/customer-credits/" + c.id}>{c.number}</Link>{" "}
              · {c.postingDate} · <MoneyCell value={c.totalAmount} />
              {c.reversedBy && " · Reversed " + c.reversedBy.postingDate}
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
