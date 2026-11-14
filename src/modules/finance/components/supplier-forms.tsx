"use client";
import { useState } from "react";
import { supplierResources } from "../payables/supplier/resources";
import type { SupplierResource } from "../payables/supplier/schemas";
import type { supplierDetail } from "../payables/supplier/service";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
type Supplier = Awaited<ReturnType<typeof supplierDetail>>["item"];
export function SupplierForm({
  item,
  hosted,
  resource = "PAYMENT",
}: {
  item?: Supplier;
  hosted: boolean;
  resource?: SupplierResource;
}) {
  const config = supplierResources[resource],
    isPayment = resource === "PAYMENT",
    isCredit = resource === "SUPPLIER_CREDIT",
    isRefund = resource === "SUPPLIER_REFUND",
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
    [bill, setBill] = useState<string | null>(item?.creditBillId ?? null);
  const [withholding, setWithholding] = useState<string | null>(
    item?.withholdingCodeId ?? null,
  );
  const [allocations, setAllocations] = useState(
      () =>
        item?.allocations.map((a) => ({
          key: a.id,
          billId: a.billId,
          amount: a.amount,
        })) ?? [],
    ),
    [credits, setCredits] = useState(
      () =>
        item?.creditLines.map((c) => ({
          key: c.id,
          billLineId: c.billLineId,
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
        ...(isPayment
          ? {
              withholdingCodeId: withholding,
              withholdingAmount: String(f.get("withholdingAmount")),
              cashAccountId: cash,
              advanceAccountId: advance,
              feeAccountId: null,
              cashAmount: String(f.get("cashAmount")),
              feeAmount: "0.00",
              allocations: allocations.map((a) => ({
                billId: a.billId,
                amount: a.amount,
              })),
            }
          : isApplication
            ? {
                sourceDocumentId: source,
                allocations: allocations.map((a) => ({
                  billId: a.billId,
                  amount: a.amount,
                })),
              }
            : isCredit
              ? {
                  billId: bill,
                  advanceAccountId: advance,
                  creditLines: credits.map((c) => ({
                    billLineId: c.billLineId,
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
          kind="supplier"
          label={config.supplierLabel}
          value={party}
          required
          onChange={(id) => {
            setParty(id);
            setSource(null);
            setBill(null);
            setAllocations([]);
            setCredits([]);
          }}
          initial={
            item ? [{ id: item.partyId, code: "", name: item.party.name }] : []
          }
        />
        {(isPayment || isRefund) && (
          <AccountPicker
            kind="cash-account"
            label={isRefund ? "Refund received into" : "Paid from"}
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
            kind="supplier-advance-source"
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
            kind="credit-bill"
            label="Credited bill"
            partyId={party ?? undefined}
            value={bill}
            onChange={(id) => {
              setBill(id);
              setCredits([]);
            }}
            required
            initial={
              item?.creditBillId
                ? [
                    {
                      id: item.creditBillId,
                      code: item.creditBill?.number ?? "",
                      name: "Original bill",
                    },
                  ]
                : []
            }
          />
        )}
      </div>
      <label>
        {isPayment
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
        {(isPayment || isRefund) && (
          <label>
            {isRefund ? "Refund amount (PKR)" : "Cash paid (PKR)"}
            <input
              name="cashAmount"
              required
              inputMode="decimal"
              defaultValue={item?.cashAmount}
            />
          </label>
        )}
      </div>
      {(isPayment || isCredit) && (
        <AccountPicker
          kind="supplier-advance"
          label={
            isCredit ? "Supplier credit asset" : "Supplier advance account"
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
      {isPayment && (
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
      {(isPayment || isApplication) && (
        <>
          {allocations.map((a, i) => (
            <fieldset key={a.key} className="panel">
              <legend>Allocation {i + 1}</legend>
              <AccountPicker
                kind="bill"
                label={"Bill for allocation " + (i + 1)}
                partyId={party ?? undefined}
                value={a.billId}
                required
                onChange={(id) =>
                  setAllocations(
                    allocations.map((x) =>
                      x.key === a.key ? { ...x, billId: id ?? "" } : x,
                    ),
                  )
                }
                initial={
                  item?.allocations.find((x) => x.billId === a.billId)
                    ? [
                        {
                          id: a.billId,
                          code: item.allocations.find(
                            (x) => x.billId === a.billId,
                          )!.bill.number,
                          name: "Current bill",
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
                { key: crypto.randomUUID(), billId: "", amount: "0.00" },
              ])
            }
          >
            Add bill allocation
          </button>
        </>
      )}
      {isCredit && (
        <>
          {credits.map((c, i) => (
            <fieldset key={c.key} className="panel">
              <legend>Credit line {i + 1}</legend>
              <AccountPicker
                kind="bill-line"
                label={"Bill line for credit " + (i + 1)}
                billId={bill ?? undefined}
                value={c.billLineId}
                required
                onChange={(id) =>
                  setCredits(
                    credits.map((x) =>
                      x.key === c.key ? { ...x, billLineId: id ?? "" } : x,
                    ),
                  )
                }
                initial={
                  item?.creditLines.find((x) => x.billLineId === c.billLineId)
                    ? [
                        {
                          id: c.billLineId,
                          code: "Bill line",
                          name: item.creditLines.find(
                            (x) => x.billLineId === c.billLineId,
                          )!.billLine.description,
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
            disabled={!bill || credits.length >= 100}
            onClick={() =>
              setCredits([
                ...credits,
                { key: crypto.randomUUID(), billLineId: "", amount: "0.00" },
              ])
            }
          >
            Add credit line
          </button>
          <p>
            Posting reduces eligible payables first. A paid portion becomes held
            supplier credit, available for application or refund.
          </p>
        </>
      )}
      {isPayment && (
        <p>
          Unallocated money needs a supplier advance account. Fees are explicit
          expenses; withholding needs a separate reviewed mapping.
        </p>
      )}
      {isApplication && (
        <p>Applying held funds records no additional cash or revenue.</p>
      )}
      {isRefund && (
        <p>
          This returns available supplier funds from the selected bank or cash
          account. A refund is not an expense.
        </p>
      )}
    </FinanceActionForm>
  );
}
export function SupplierAction({
  item,
  action,
  hosted,
  resource = "PAYMENT",
}: {
  item: Supplier;
  action: "POST" | "VOID" | "REVERSE" | "UNALLOCATE";
  hosted: boolean;
  resource?: SupplierResource;
}) {
  const config = supplierResources[resource],
    [advance, setAdvance] = useState<string | null>(item.advanceAccountId),
    label =
      action === "UNALLOCATE"
        ? "Release bill settlements"
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
        action === "UNALLOCATE" ? "/finance/supplier-releases/" : undefined
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
            kind="supplier-advance"
            label="Released supplier funds account"
            value={advance}
            onChange={setAdvance}
            required
          />
          <p>
            Release every bill allocation from this payment into held supplier
            funds. Cash stays in the company account. This release can be
            recorded once.
          </p>
        </>
      )}
      <label className="check-label">
        <input type="checkbox" required />I reviewed the supplier, amounts,
        evidence and posting date.
      </label>
    </FinanceActionForm>
  );
}
