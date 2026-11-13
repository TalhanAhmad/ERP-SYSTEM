"use client";
import { useState } from "react";
import { customerResources } from "../receivables/customer/resources";
import type { CustomerResource } from "../receivables/customer/schemas";
import type { customerDetail } from "../receivables/customer/service";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
type Customer = Awaited<ReturnType<typeof customerDetail>>["item"];
export function CustomerForm({
  item,
  hosted,
  resource = "RECEIPT",
}: {
  item?: Customer;
  hosted: boolean;
  resource?: CustomerResource;
}) {
  const config = customerResources[resource],
    isReceipt = resource === "RECEIPT",
    isCredit = resource === "CUSTOMER_CREDIT",
    isRefund = resource === "CUSTOMER_REFUND",
    isApplication = resource === "ADVANCE_APPLICATION";
  const [project, setProject] = useState<string | null>(
    item?.projectId ?? null,
  );
  const [party, setParty] = useState<string | null>(item?.partyId ?? null),
    [cash, setCash] = useState<string | null>(item?.cashAccountId ?? null),
    [source, setSource] = useState<string | null>(
      item?.sourceDocumentId ?? null,
    ),
    [advance, setAdvance] = useState<string | null>(
      item?.advanceAccountId ?? null,
    ),
    [invoice, setInvoice] = useState<string | null>(
      item?.creditInvoiceId ?? null,
    ),
    [feeAccount, setFeeAccount] = useState<string | null>(
      item?.feeAccountId ?? null,
    ),
    [fee, setFee] = useState(item?.feeAmount ?? "0.00");
  const [withholding, setWithholding] = useState<string | null>(
    item?.withholdingCodeId ?? null,
  );
  const [allocations, setAllocations] = useState(
      () =>
        item?.allocations.map((a) => ({
          key: a.id,
          invoiceId: a.invoiceId,
          amount: a.amount,
        })) ?? [],
    ),
    [credits, setCredits] = useState(
      () =>
        item?.creditLines.map((c) => ({
          key: c.id,
          invoiceLineId: c.invoiceLineId,
          amount: c.amount,
        })) ?? [],
    );
  return (
    <FinanceActionForm
      label={(item ? "Save " : "Create ") + config.singular + " draft"}
      endpoint={"/api/v1/finance/" + config.path + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/" + config.path + "/"}
      hosted={hosted}
      business={(f) => ({
        reference: String(f.get("reference")),
        partyId: party,
        projectId: project,
        documentDate: String(f.get("documentDate")),
        postingDate: String(f.get("postingDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        currency: "PKR",
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
        ...(isReceipt
          ? {
              withholdingCodeId: withholding,
              withholdingAmount: String(f.get("withholdingAmount")),
              cashAccountId: cash,
              advanceAccountId: advance,
              feeAccountId: /^0(?:\.0{1,2})?$/.test(fee) ? null : feeAccount,
              cashAmount: String(f.get("cashAmount")),
              feeAmount: fee,
              allocations: allocations.map((a) => ({
                invoiceId: a.invoiceId,
                amount: a.amount,
              })),
            }
          : isApplication
            ? {
                sourceDocumentId: source,
                allocations: allocations.map((a) => ({
                  invoiceId: a.invoiceId,
                  amount: a.amount,
                })),
              }
            : isCredit
              ? {
                  invoiceId: invoice,
                  advanceAccountId: advance,
                  creditLines: credits.map((c) => ({
                    invoiceLineId: c.invoiceLineId,
                    amount: c.amount,
                  })),
                }
              : {
                  sourceDocumentId: source,
                  cashAccountId: cash,
                  cashAmount: String(f.get("cashAmount")),
                }),
      })}
    >
      <div className="form-grid">
        <AccountPicker
          kind="party"
          label={config.clientLabel}
          value={party}
          required
          onChange={(id) => {
            setParty(id);
            setSource(null);
            setInvoice(null);
            setAllocations([]);
            setCredits([]);
          }}
          initial={
            item ? [{ id: item.partyId, code: "", name: item.party.name }] : []
          }
        />
        {(isReceipt || isRefund) && (
          <AccountPicker
            kind="cash-account"
            label={isRefund ? "Refund from" : "Received into"}
            value={cash}
            onChange={setCash}
            required
            initial={
              item?.cashAccountId
                ? [
                    {
                      id: item.cashAccountId,
                      code: "",
                      name: item.cashAccount?.name ?? "Current cash account",
                    },
                  ]
                : []
            }
          />
        )}
        {(isApplication || isRefund) && (
          <AccountPicker
            kind="advance-source"
            label={isRefund ? "Refund source funds" : "Source advance"}
            partyId={party ?? undefined}
            value={source}
            onChange={setSource}
            required
            initial={
              item?.sourceDocumentId
                ? [
                    {
                      id: item.sourceDocumentId,
                      code: item.sourceDocument?.number ?? "",
                      name: "Current source",
                    },
                  ]
                : []
            }
          />
        )}
        {isCredit && (
          <AccountPicker
            kind="credit-invoice"
            label="Credited invoice"
            partyId={party ?? undefined}
            value={invoice}
            onChange={(id) => {
              setInvoice(id);
              setCredits([]);
            }}
            required
            initial={
              item?.creditInvoiceId
                ? [
                    {
                      id: item.creditInvoiceId,
                      code: item.creditInvoice?.number ?? "",
                      name: "Original invoice",
                    },
                  ]
                : []
            }
          />
        )}
      </div>
      <label>
        {isReceipt
          ? "Bank or cash reference"
          : isApplication
            ? "Application reference"
            : isCredit
              ? "Credit reference"
              : "Refund reference"}
        <input
          name="reference"
          required
          maxLength={80}
          defaultValue={item?.reference}
        />
      </label>
      <AccountPicker
        kind="project"
        label="Document project"
        value={project}
        onChange={setProject}
      />
      <div className="form-grid">
        <label>
          {config.dateLabel}
          <input
            name="documentDate"
            type="date"
            required
            defaultValue={item?.documentDate}
          />
        </label>
        <label>
          Posting date
          <input
            name="postingDate"
            type="date"
            required
            defaultValue={item?.postingDate}
          />
        </label>
        {(isReceipt || isRefund) && (
          <label>
            {isRefund ? "Refund amount (PKR)" : "Cash received (PKR)"}
            <input
              name="cashAmount"
              required
              inputMode="decimal"
              defaultValue={item?.cashAmount}
            />
          </label>
        )}
        {isReceipt && (
          <label>
            Explicit fee (PKR)
            <input
              value={fee}
              required
              inputMode="decimal"
              onChange={(e) => setFee(e.target.value)}
            />
          </label>
        )}
      </div>
      {isReceipt && !/^0(?:\.0{1,2})?$/.test(fee) && (
        <AccountPicker
          kind="fee"
          label="Fee expense account"
          value={feeAccount}
          onChange={setFeeAccount}
          required
          initial={
            item?.feeAccountId && item.feeAccount
              ? [{ id: item.feeAccountId, ...item.feeAccount }]
              : []
          }
        />
      )}
      {(isReceipt || isCredit) && (
        <AccountPicker
          kind="advance"
          label={
            isCredit ? "Customer credit liability" : "Client advance account"
          }
          value={advance}
          onChange={setAdvance}
          required={isCredit}
          initial={
            item?.advanceAccountId && item.advanceAccount
              ? [{ id: item.advanceAccountId, ...item.advanceAccount }]
              : []
          }
        />
      )}
      {isReceipt && (
        <>
          <label>
            Evidenced withholding (PKR)
            <input
              name="withholdingAmount"
              inputMode="decimal"
              required
              defaultValue={item?.withholdingAmount ?? "0.00"}
            />
          </label>
          <AccountPicker
            kind="withholding-code"
            label="Withholding policy"
            value={withholding}
            onChange={setWithholding}
          />
          <p>
            Enter the withholding from settlement evidence. Cash, explicit fees
            (when supported) and withholding together must equal bill/invoice
            allocations plus any advance.
          </p>
        </>
      )}
      <label>
        Document description
        <textarea
          name="description"
          defaultValue={item?.description}
          required
          maxLength={1000}
        />
      </label>
      <label>
        Supporting evidence reference
        <textarea
          name="evidence"
          defaultValue={item?.evidence}
          required
          minLength={3}
          maxLength={1000}
        />
      </label>
      {(isReceipt || isApplication) && (
        <>
          {allocations.map((a, i) => (
            <fieldset key={a.key} className="panel">
              <legend>Allocation {i + 1}</legend>
              <AccountPicker
                kind="invoice"
                label={"Invoice for allocation " + (i + 1)}
                partyId={party ?? undefined}
                value={a.invoiceId}
                required
                onChange={(id) =>
                  setAllocations(
                    allocations.map((x) =>
                      x.key === a.key ? { ...x, invoiceId: id ?? "" } : x,
                    ),
                  )
                }
                initial={
                  item?.allocations.find((x) => x.invoiceId === a.invoiceId)
                    ? [
                        {
                          id: a.invoiceId,
                          code: item.allocations.find(
                            (x) => x.invoiceId === a.invoiceId,
                          )!.invoice.number,
                          name: "Current invoice",
                        },
                      ]
                    : []
                }
              />
              <label>
                Allocation {i + 1} amount (PKR)
                <input
                  required
                  inputMode="decimal"
                  value={a.amount}
                  onChange={(e) =>
                    setAllocations(
                      allocations.map((x) =>
                        x.key === a.key ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setAllocations(allocations.filter((x) => x.key !== a.key))
                }
              >
                Remove allocation {i + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={!party || allocations.length >= 100}
            onClick={() =>
              setAllocations([
                ...allocations,
                { key: crypto.randomUUID(), invoiceId: "", amount: "0.00" },
              ])
            }
          >
            Add invoice allocation
          </button>
        </>
      )}
      {isCredit && (
        <>
          {credits.map((c, i) => (
            <fieldset key={c.key} className="panel">
              <legend>Credit line {i + 1}</legend>
              <AccountPicker
                kind="invoice-line"
                label={"Invoice line for credit " + (i + 1)}
                invoiceId={invoice ?? undefined}
                value={c.invoiceLineId}
                required
                onChange={(id) =>
                  setCredits(
                    credits.map((x) =>
                      x.key === c.key ? { ...x, invoiceLineId: id ?? "" } : x,
                    ),
                  )
                }
                initial={
                  item?.creditLines.find(
                    (x) => x.invoiceLineId === c.invoiceLineId,
                  )
                    ? [
                        {
                          id: c.invoiceLineId,
                          code: "Invoice line",
                          name: item.creditLines.find(
                            (x) => x.invoiceLineId === c.invoiceLineId,
                          )!.invoiceLine.description,
                        },
                      ]
                    : []
                }
              />
              <label>
                Credit line {i + 1} amount (PKR)
                <input
                  required
                  inputMode="decimal"
                  value={c.amount}
                  onChange={(e) =>
                    setCredits(
                      credits.map((x) =>
                        x.key === c.key ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setCredits(credits.filter((x) => x.key !== c.key))
                }
              >
                Remove credit line {i + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={!invoice || credits.length >= 100}
            onClick={() =>
              setCredits([
                ...credits,
                { key: crypto.randomUUID(), invoiceLineId: "", amount: "0.00" },
              ])
            }
          >
            Add credit line
          </button>
          <p>
            Posting reduces eligible receivables first. A paid portion becomes
            held customer credit, available for application or refund.
          </p>
        </>
      )}
      {isReceipt && (
        <p>
          Unallocated money needs a client advance account. Fees are explicit
          expenses; withholding needs a separate reviewed mapping.
        </p>
      )}
      {isApplication && (
        <p>Applying held funds records no additional cash or revenue.</p>
      )}
      {isRefund && (
        <p>
          This returns available client funds from the selected bank or cash
          account. A refund is not an expense.
        </p>
      )}
    </FinanceActionForm>
  );
}
export function CustomerAction({
  item,
  action,
  hosted,
  resource = "RECEIPT",
}: {
  item: Customer;
  action: "POST" | "VOID" | "REVERSE" | "UNALLOCATE";
  hosted: boolean;
  resource?: CustomerResource;
}) {
  const config = customerResources[resource],
    [advance, setAdvance] = useState<string | null>(item.advanceAccountId),
    label =
      action === "UNALLOCATE"
        ? "Release invoice settlements"
        : (action === "POST"
            ? "Post "
            : action === "REVERSE"
              ? "Reverse "
              : "Void ") +
          config.singular +
          (action === "VOID" ? " draft" : "");
  return (
    <FinanceActionForm
      label={label}
      endpoint={
        "/api/v1/finance/" +
        config.path +
        "/" +
        item.id +
        "/" +
        action.toLowerCase()
      }
      hosted={hosted}
      redirectPrefix={
        action === "UNALLOCATE" ? "/finance/receipt-unallocations/" : undefined
      }
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
        ...(["REVERSE", "UNALLOCATE"].includes(action)
          ? { postingDate: String(f.get("postingDate")) }
          : {}),
        ...(action === "UNALLOCATE" ? { advanceAccountId: advance } : {}),
      })}
    >
      {["REVERSE", "UNALLOCATE"].includes(action) && (
        <label>
          Correction posting date
          <input
            name="postingDate"
            type="date"
            min={item.postingDate}
            required
          />
        </label>
      )}
      {action === "UNALLOCATE" && (
        <>
          <AccountPicker
            kind="advance"
            label="Released client funds account"
            value={advance}
            onChange={setAdvance}
            required
          />
          <p>
            Release every invoice allocation from this receipt into held client
            funds. Cash stays in the company account. This release can be
            recorded once.
          </p>
        </>
      )}
      <label className="check-label">
        <input type="checkbox" required />I reviewed the client, amounts,
        evidence and posting date.
      </label>
    </FinanceActionForm>
  );
}
