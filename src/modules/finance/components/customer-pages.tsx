import Link from "next/link";
import { customerResources } from "../receivables/customer/resources";
import type { CustomerResource } from "../receivables/customer/schemas";
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
  resource = "RECEIPT",
}: {
  resource?: CustomerResource;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = customerResources[resource];
  const raw = await searchParams,
    { d, invalid } = await financePageData(async (a) => {
      const p = customerQuerySchema.safeParse(raw);
      return {
        d: await customers(a, resource, p.success ? p.data : {}),
        invalid: !p.success,
      };
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>{config.plural}</h1>
      <p>Actual cash received and dated invoice settlements.</p>
      <Link
        className="button primary"
        href={"/finance/" + config.path + "/new"}
      >
        New {config.singular} draft
      </Link>
      {invalid && (
        <p role="alert">Invalid filters. Showing the default view.</p>
      )}
      <FinanceRegister
        drawer={false}
        label={resource === "RECEIPT" ? "Receipt" : "Advance application"}
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
          href: "/finance/" + config.path + "/" + i.id,
          endpoint: "/api/v1/finance/" + config.path + "/" + i.id,
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
          "/finance/" +
          config.path +
          "?" +
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
export async function NewReceipt({
  resource = "RECEIPT",
}: { resource?: CustomerResource } = {}) {
  const config = customerResources[resource];
  await financePageData(financeStatus);
  return (
    <section>
      <FinanceNavigation />
      <h1>New {config.singular} draft</h1>
      <CustomerForm
        resource={resource}
        hosted={env.AUTH_PROVIDER === "supabase"}
      />
    </section>
  );
}
export async function ReceiptDetail({
  params,
  resource = "RECEIPT",
}: {
  params: Promise<{ id: string }>;
  resource?: CustomerResource;
}) {
  const config = customerResources[resource],
    title = config.singular.charAt(0).toUpperCase() + config.singular.slice(1);
  const { id } = await params,
    d = await financePageData((a) => customerDetail(a, resource, id)),
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
      <section className="panel" aria-label={title + " preview"}>
        <h2>{title} preview</h2>
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
      {(i.advanceAmount !== "0.00" || resource === "ADVANCE_APPLICATION") && (
        <section className="panel" aria-label="Client advance">
          <h2>Client advance</h2>
          <p>
            Held from this receipt: <MoneyCell value={i.advanceAmount} /> ·
            Available from source: <MoneyCell value={d.availableAdvance} />
          </p>
          {i.sourceDocument && <p>Source {i.sourceDocument.number}</p>}
          <Link href="/finance/advance-applications/new">
            Apply held client money
          </Link>
        </section>
      )}
      {i.state === "DRAFT" && (
        <>
          <section
            className="panel"
            aria-label={"Edit " + config.singular + " draft"}
          >
            <h2>Edit {config.singular} draft</h2>
            <CustomerForm
              resource={resource}
              key={i.version}
              item={i}
              hosted={hosted}
            />
          </section>
          {(["POST", "VOID"] as const).map((action) => (
            <section
              className="panel"
              aria-label={
                action === "POST"
                  ? "Post " + config.singular
                  : "Void " + config.singular + " draft"
              }
              key={action}
            >
              <h2>
                {action === "POST"
                  ? "Post " + config.singular
                  : "Void " + config.singular + " draft"}
              </h2>
              <CustomerAction
                resource={resource}
                item={i}
                action={action}
                hosted={hosted}
              />
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
