import {EvidenceSection} from "./evidence-section";
import Link from "next/link";
import { env } from "@/server/env";
import { supplierResources } from "../payables/supplier/resources";
import type { SupplierResource } from "../payables/supplier/schemas";
import { financePageData } from "../accounting/page-data";
import { financeStatus } from "../access/policy";
import { suppliers, supplierDetail } from "../payables/supplier/service";
import { supplierQuerySchema } from "../payables/supplier/schemas";
import { FinanceNavigation, SetupHistory } from "./setup-navigation";
import { FinanceRegister } from "./finance-register";
import { SupplierForm, SupplierAction } from "./supplier-forms";
import { MoneyCell } from "./money-cell";
export async function PaymentRegister({
  searchParams,
  resource = "PAYMENT",
}: {
  resource?: SupplierResource;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = supplierResources[resource],
    raw = await searchParams,
    { d, invalid } = await financePageData(async (a) => {
      const p = supplierQuerySchema.safeParse(raw);
      return {
        d: await suppliers(a, resource, p.success ? p.data : {}),
        invalid: !p.success,
      };
    });
  return (
    <section>
      <FinanceNavigation />
      <h1>{config.plural}</h1>
      <p>
        {resource === "PAYMENT"
          ? "Actual cash paid and dated bill settlements."
          : resource === "ADVANCE_APPLICATION"
            ? "Apply held supplier funds to bills without paying cash again."
            : resource === "SUPPLIER_CREDIT"
              ? "Credit eligible bill lines and retain the original billing history."
              : resource === "SUPPLIER_REFUND"
                ? "Record cash returned by the supplier against an available advance or credit."
                : "Bill settlements released into held funds; cash remains paid to the supplier."}
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
        columns={[
          "Document",
          "Posting date",
          "Supplier",
          "State",
          "Total (PKR)",
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
            Includes the selected states and is not a bank or payable balance.
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
export async function NewPayment({
  resource = "PAYMENT",
}: { resource?: SupplierResource } = {}) {
  await financePageData(financeStatus);
  const config = supplierResources[resource];
  return (
    <section>
      <FinanceNavigation />
      <h1>New {config.singular} draft</h1>
      <SupplierForm
        resource={resource}
        hosted={env.AUTH_PROVIDER === "supabase"}
      />
    </section>
  );
}
export async function PaymentDetail({
  params,
  resource = "PAYMENT",
}: {
  params: Promise<{ id: string }>;
  resource?: SupplierResource;
}) {
  const { id } = await params,
    d = await financePageData((a) => supplierDetail(a, resource, id)),
    i = d.item,
    config = supplierResources[resource],
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
        {resource === "PAYMENT" && (
          <p>
            Cash received <MoneyCell value={i.cashAmount} /> · Fees{" "}
            <MoneyCell value={i.feeAmount} /> · Withholding{" "}
            <MoneyCell value={i.withholdingAmount} /> · Bill settlements{" "}
            <MoneyCell value={i.allocationAmount} /> · Held advance{" "}
            <MoneyCell value={i.advanceAmount} />
          </p>
        )}
        {resource === "SUPPLIER_REFUND" && (
          <p>
            Cash returned: <MoneyCell value={i.cashAmount} />. This is a
            supplier liability settlement, not an expense.
          </p>
        )}
        {i.sourceDocument && <p>Source {i.sourceDocument.number}</p>}
        {i.creditBill && (
          <p>
            Original bill{" "}
            <Link href={"/finance/bills/" + i.creditBillId}>
              {i.creditBill.number}
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
                  <th scope="col">Bill</th>
                  <th scope="col">Amount (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {i.allocations.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={"/finance/bills/" + a.billId}>
                        {a.bill.number}
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
                    <td>{c.billLine.description}</td>
                    <td>{c.billLine.treatment}</td>
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
            Payables reduced: <MoneyCell value={i.creditSplit.arAmount} /> ·
            Held supplier credit:{" "}
            <MoneyCell value={i.creditSplit.balanceAmount} />
          </p>
        )}
      </section>
      {(i.advanceAccountId || d.sourceEvents.length > 0) && (
        <section className="panel" aria-label="Supplier funds">
          <h2>Supplier funds</h2>
          <p>
            Current available from source:{" "}
            <MoneyCell value={d.availableAdvance} />
          </p>
          <Link href="/finance/supplier-applications/new">
            Apply held supplier funds
          </Link>
          {" · "}
          <Link href="/finance/supplier-refunds/new">
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
            <SupplierForm
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
              <SupplierAction
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
          {resource === "PAYMENT" &&
            !i.unallocatedBy &&
            i.allocationAmount !== "0.00" && (
              <section className="panel" aria-label="Release bill settlements">
                <h2>Release bill settlements</h2>
                <SupplierAction
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
              <Link href={"/finance/supplier-releases/" + i.unallocatedBy.id}>
                settlement release {i.unallocatedBy.number}
              </Link>{" "}
              before reversing this payment.
            </p>
          ) : (
            <section
              className="panel"
              aria-label={"Reverse " + config.singular}
            >
              <h2>Reverse {config.singular}</h2>
              <p>
                Create dated opposite entries. Original records remain in
                earlier balances. Restore consumed supplier funds first.
              </p>
              <SupplierAction
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
          <Link href={"/finance/supplier-releases/" + i.unallocatedBy.id}>
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
      <EvidenceSection sourceType="SUPPLIER_DOCUMENT" sourceId={i.id} state={i.storedState}/>
      <SetupHistory events={d.history} />
    </section>
  );
}
