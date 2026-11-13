import {EvidenceSection} from "./evidence-section";
import Link from "next/link";
import { env } from "@/server/env";
import { customerResources } from "../receivables/customer/resources";
import type { CustomerResource } from "../receivables/customer/schemas";
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
  const config = customerResources[resource],
    raw = await searchParams,
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
      <p>
        {resource === "RECEIPT"
          ? "Actual cash received and dated invoice settlements."
          : resource === "ADVANCE_APPLICATION"
            ? "Apply held client funds to invoices without receiving cash again."
            : resource === "CUSTOMER_CREDIT"
              ? "Credit eligible invoice lines and retain the original billing history."
              : resource === "CUSTOMER_REFUND"
                ? "Return available client funds from bank or cash."
                : "Invoice settlements released into held funds; cash remains in the company account."}
      </p>
      {resource !== "UNALLOCATION" && (
        <Link
          className="button primary"
          href={"/finance/" + config.path + "/new"}
        >
          New {config.singular} draft
        </Link>
      )}
      {invalid && (
        <p role="alert">Invalid filters. Showing the default view.</p>
      )}
      <FinanceRegister
        drawer={false}
        label={config.singular}
        columns={["Document", "Posting date", "Client", "State", "Total (PKR)"]}
        rows={d.items.map((i) => ({
          id: i.id,
          name: i.number,
          href: "/finance/" + config.path + "/" + i.id,
          endpoint: "/api/v1/finance/" + config.path + "/" + i.id,
          cells: [
            i.postingDate,
            (i.partySnapshot as { name?: string } | null)?.name ?? i.party.name,
            i.state,
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
            Filtered document total: <MoneyCell value={d.totals.totalAmount} />.
            Includes the selected states and is not a bank or receivable
            balance.
          </p>
        }
      >
        <form method="get" className="form-grid">
          <label>
            Search documents
            <input name="q" defaultValue={d.filters.q} maxLength={100} />
          </label>
          <label>
            Document state
            <select name="state" defaultValue={d.filters.state}>
              {["ALL", "DRAFT", "POSTED", "REVERSED", "VOIDED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply filters</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
export async function NewReceipt({
  resource = "RECEIPT",
}: { resource?: CustomerResource } = {}) {
  await financePageData(financeStatus);
  const config = customerResources[resource];
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
  const { id } = await params,
    d = await financePageData((a) => customerDetail(a, resource, id)),
    i = d.item,
    config = customerResources[resource],
    title = config.singular.charAt(0).toUpperCase() + config.singular.slice(1),
    hosted = env.AUTH_PROVIDER === "supabase",
    party = (i.storedState === "POSTED" ? i.partySnapshot : i.party) as {
      name: string;
      legalName: string;
      address?: string | null;
      contactEmail?: string | null;
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
        <p style={{ whiteSpace: "pre-wrap" }}>{party.address}</p>
        <p>{party.contactEmail}</p>
        <p>{i.description}</p>
        <p>
          Reference {i.reference} · Document date {i.documentDate} · Posting
          date {i.postingDate}
        </p>
        <p>
          Total <MoneyCell value={i.totalAmount} />
        </p>
        {resource === "RECEIPT" && (
          <p>
            Cash received <MoneyCell value={i.cashAmount} /> · Fees{" "}
            <MoneyCell value={i.feeAmount} /> · Withholding{" "}
            <MoneyCell value={i.withholdingAmount} /> · Invoice settlements{" "}
            <MoneyCell value={i.allocationAmount} /> · Held advance{" "}
            <MoneyCell value={i.advanceAmount} />
          </p>
        )}
        {resource === "CUSTOMER_REFUND" && (
          <p>
            Cash returned: <MoneyCell value={i.cashAmount} />. This is a client
            liability settlement, not an expense.
          </p>
        )}
        {i.sourceDocument && <p>Source {i.sourceDocument.number}</p>}
        {i.creditInvoice && (
          <p>
            Original invoice{" "}
            <Link href={"/finance/invoices/" + i.creditInvoiceId}>
              {i.creditInvoice.number}
            </Link>
          </p>
        )}
        {!!i.allocations.length && (
          <div
            className="table-wrap"
            role="region"
            aria-label="Document allocations"
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
        )}
        {!!i.creditLines.length && (
          <div
            className="table-wrap"
            role="region"
            aria-label="Credit note lines"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Original line</th>
                  <th scope="col">Treatment</th>
                  <th scope="col">Credit (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {i.creditLines.map((c) => (
                  <tr key={c.id}>
                    <td>{c.invoiceLine.description}</td>
                    <td>{c.invoiceLine.recognition}</td>
                    <td>
                      <MoneyCell value={c.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {i.creditSplit && (
          <p>
            Receivables reduced: <MoneyCell value={i.creditSplit.arAmount} /> ·
            Held customer credit:{" "}
            <MoneyCell value={i.creditSplit.balanceAmount} />
          </p>
        )}
        {resource === "CUSTOMER_CREDIT" && i.storedState === "POSTED" && (
          <a
            className="button"
            href={"/api/v1/finance/customer-credits/" + i.id + "/pdf"}
          >
            Download private credit note PDF
          </a>
        )}
      </section>
      {(i.advanceAccountId || d.sourceEvents.length > 0) && (
        <section className="panel" aria-label="Client funds">
          <h2>Client funds</h2>
          <p>
            Current available from source:{" "}
            <MoneyCell value={d.availableAdvance} />
          </p>
          <Link href="/finance/advance-applications/new">
            Apply held client funds
          </Link>
          {" · "}
          <Link href="/finance/customer-refunds/new">
            Return available funds
          </Link>
          {d.sourceEvents.map((e) => (
            <p key={e.id}>
              {e.effectiveDate} · {e.document.number} · {e.kind} ·{" "}
              <MoneyCell value={e.amount} />
            </p>
          ))}
        </section>
      )}
      {i.state === "DRAFT" && resource !== "UNALLOCATION" && (
        <>
          <section
            className="panel"
            aria-label={"Edit " + config.singular + " draft"}
          >
            <h2>Edit {config.singular} draft</h2>
            <CustomerForm
              key={i.version}
              resource={resource}
              item={i}
              hosted={hosted}
            />
          </section>
          {(["POST", "VOID"] as const).map((action) => (
            <section
              className="panel"
              aria-label={
                (action === "POST" ? "Post " : "Void ") +
                config.singular +
                (action === "VOID" ? " draft" : "")
              }
              key={action}
            >
              <h2>
                {action === "POST" ? "Post " : "Void "}
                {config.singular}
                {action === "VOID" ? " draft" : ""}
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
      {i.state === "POSTED" && (
        <>
          {resource === "RECEIPT" &&
            !i.unallocatedBy &&
            i.allocationAmount !== "0.00" && (
              <section
                className="panel"
                aria-label="Release invoice settlements"
              >
                <h2>Release invoice settlements</h2>
                <CustomerAction
                  resource={resource}
                  item={i}
                  action="UNALLOCATE"
                  hosted={hosted}
                />
              </section>
            )}
          {i.unallocatedBy && !i.unallocatedBy.reversedBy ? (
            <p>
              Reverse the active{" "}
              <Link
                href={"/finance/receipt-unallocations/" + i.unallocatedBy.id}
              >
                settlement release {i.unallocatedBy.number}
              </Link>{" "}
              before reversing this receipt.
            </p>
          ) : (
            <section
              className="panel"
              aria-label={"Reverse " + config.singular}
            >
              <h2>Reverse {config.singular}</h2>
              <p>
                Create dated opposite entries. Original records remain in
                earlier balances. Restore consumed client funds first.
              </p>
              <CustomerAction
                resource={resource}
                item={i}
                action="REVERSE"
                hosted={hosted}
              />
            </section>
          )}
        </>
      )}
      {i.unallocatedBy && (
        <p>
          Settlement release{" "}
          <Link href={"/finance/receipt-unallocations/" + i.unallocatedBy.id}>
            {i.unallocatedBy.number}
          </Link>{" "}
          · {i.unallocatedBy.postingDate}
        </p>
      )}
      {i.reversedBy && (
        <section className="panel" aria-label="Dated reversal">
          <h2>Dated reversal</h2>
          <p>
            {i.reversedBy.number} · {i.reversedBy.postingDate} ·{" "}
            {i.reversedBy.entry?.reference}
          </p>
          {i.reversedBy.entry && (
            <div
              className="table-wrap"
              role="region"
              aria-label="Reversal journal lines"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Debit</th>
                    <th scope="col">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {i.reversedBy.entry.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.account.code} · {l.account.name}
                      </td>
                      <td>
                        <MoneyCell value={l.debit} />
                      </td>
                      <td>
                        <MoneyCell value={l.credit} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {i.entry && (
        <section className="panel" aria-label="Posted journal">
          <h2>Posted journal</h2>
          <p>
            {i.entry.reference} · {i.entry.postingDate}
          </p>
          <div
            className="table-wrap"
            role="region"
            aria-label="Document journal lines"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Debit</th>
                  <th scope="col">Credit</th>
                </tr>
              </thead>
              <tbody>
                {i.entry.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.account.code} · {l.account.name}
                    </td>
                    <td>
                      <MoneyCell value={l.debit} />
                    </td>
                    <td>
                      <MoneyCell value={l.credit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <EvidenceSection sourceType="CUSTOMER_DOCUMENT" sourceId={i.id} state={i.storedState}/>
      <SetupHistory events={d.history} />
    </section>
  );
}
