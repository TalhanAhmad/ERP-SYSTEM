import Link from "next/link";
import { env } from "@/server/env";
import { financePageData } from "../accounting/page-data";
import { financeStatus } from "../access/policy";
import { customers, customerDetail } from "../receivables/customer/service";
import { customerQuerySchema } from "../receivables/customer/schemas";
import { FinanceNavigation, SetupHistory } from "./setup-navigation";
import { FinanceRegister } from "./finance-register";
import { CustomerForm, CustomerAction } from "./customer-forms";
import { MoneyCell } from "./money-cell";
export async function ReceiptRegister({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    { d, invalid } = await financePageData(async (a) => {
      const p = customerQuerySchema.safeParse(raw);
      return {
        d: await customers(a, "RECEIPT", p.success ? p.data : {}),
        invalid: !p.success,
      };
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>Receipts</h1>
      <p>Actual cash received and dated invoice settlements.</p>
      <Link className="button primary" href="/finance/receipts/new">
        New receipt draft
      </Link>
      {invalid && (
        <p role="alert">Invalid filters. Showing the default view.</p>
      )}
      <FinanceRegister
        drawer={false}
        label="Receipt"
        columns={[
          "Receipt",
          "Date",
          "Client",
          "State",
          "Cash (PKR)",
          "Settlement (PKR)",
        ]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/receipts/" + i.id,
          endpoint: "/api/v1/finance/receipts/" + i.id,
          cells: [
            i.postingDate,
            (i.partySnapshot as { name?: string } | null)?.name ?? i.party.name,
            i.state,
            <MoneyCell key="cash" value={i.cashAmount} />,
            <MoneyCell key="total" value={i.totalAmount} />,
          ],
        }))}
        total={d.total}
        page={d.page}
        pages={d.pages}
        href={(page) =>
          "/finance/receipts?" +
          new URLSearchParams(
            Object.entries({ ...d.filters, page })
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          )
        }
        totals={
          <p>
            Filtered cash: <MoneyCell value={d.totals.cashAmount} />. Includes
            selected document states.
          </p>
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search receipts
            <input name="q" defaultValue={d.filters.q} />
          </label>
          <label>
            Receipt state
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "DRAFT", "POSTED", "VOIDED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply receipt filters</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
export async function NewReceipt() {
  await financePageData(financeStatus);
  return (
    <section>
      <FinanceNavigation />
      <h1>New receipt draft</h1>
      <CustomerForm hosted={env.AUTH_PROVIDER === "supabase"} />
    </section>
  );
}
export async function ReceiptDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    d = await financePageData((a) => customerDetail(a, "RECEIPT", id)),
    i = d.item,
    hosted = env.AUTH_PROVIDER === "supabase",
    party = (i.state === "POSTED" ? i.partySnapshot : i.party) as {
      name: string;
      legalName: string;
    };
  return (
    <section>
      <FinanceNavigation />
      <h1>{i.number}</h1>
      <p>
        {i.state} · version {i.version} · {i.postingDate}
      </p>
      <section className="panel" aria-label="Receipt preview">
        <h2>Receipt preview</h2>
        <p>
          {party.legalName} · {party.name}
        </p>
        <p>{i.description}</p>
        <p>
          Reference {i.reference} · Received {i.documentDate}
        </p>
        <p>
          Cash <MoneyCell value={i.cashAmount} /> · Fees{" "}
          <MoneyCell value={i.feeAmount} /> · Settlement{" "}
          <MoneyCell value={i.totalAmount} />
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Receipt allocations"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Amount (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {i.allocations.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={"/finance/invoices/" + a.invoiceId}>
                      {a.invoice.number}
                    </Link>
                  </td>
                  <td>
                    <MoneyCell value={a.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {i.state === "DRAFT" && (
        <>
          <section className="panel" aria-label="Edit receipt draft">
            <h2>Edit receipt draft</h2>
            <CustomerForm key={i.version} item={i} hosted={hosted} />
          </section>
          {(["POST", "VOID"] as const).map((action) => (
            <section
              className="panel"
              aria-label={
                action === "POST" ? "Post receipt" : "Void receipt draft"
              }
              key={action}
            >
              <h2>
                {action === "POST" ? "Post receipt" : "Void receipt draft"}
              </h2>
              <CustomerAction item={i} action={action} hosted={hosted} />
            </section>
          ))}
        </>
      )}
      {i.entry && (
        <p>
          Journal {i.entry.reference} · {i.entry.postingDate}
        </p>
      )}
      <SetupHistory events={d.history} />
    </section>
  );
}
