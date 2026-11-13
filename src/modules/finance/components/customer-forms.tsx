"use client";
import { useState } from "react";
import type { customerDetail } from "../receivables/customer/service";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
type Customer = Awaited<ReturnType<typeof customerDetail>>["item"];
export function CustomerForm({
  item,
  hosted,
}: {
  item?: Customer;
  hosted: boolean;
}) {
  const [party, setParty] = useState<string | null>(item?.partyId ?? null),
    [cash, setCash] = useState<string | null>(item?.cashAccountId ?? null),
    [feeAccount, setFeeAccount] = useState<string | null>(
      item?.feeAccountId ?? null,
    ),
    [fee, setFee] = useState(item?.feeAmount ?? "0.00"),
    [project, setProject] = useState<string | null>(item?.projectId ?? null),
    [allocations, setAllocations] = useState(
      () =>
        item?.allocations.map((a) => ({
          key: a.id,
          invoiceId: a.invoiceId,
          amount: a.amount,
        })) ?? [],
    );
  return (
    <FinanceActionForm
      label={item ? "Save receipt draft" : "Create receipt draft"}
      endpoint={"/api/v1/finance/receipts" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/receipts/"}
      hosted={hosted}
      business={(f) => ({
        reference: String(f.get("reference")),
        partyId: party,
        cashAccountId: cash,
        projectId: project,
        feeAccountId: /^0(?:\.0{1,2})?$/.test(fee) ? null : feeAccount,
        cashAmount: String(f.get("cashAmount")),
        feeAmount: fee,
        documentDate: String(f.get("documentDate")),
        postingDate: String(f.get("postingDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        currency: "PKR",
        allocations: allocations.map((a) => ({
          invoiceId: a.invoiceId,
          amount: a.amount,
        })),
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <div className="form-grid">
        <AccountPicker
          kind="party"
          label="Receipt client"
          value={party}
          onChange={(id) => {
            setParty(id);
            setAllocations([]);
          }}
          required
          initial={
            item ? [{ id: item.partyId, code: "", name: item.party.name }] : []
          }
        />
        <AccountPicker
          kind="cash-account"
          label="Received into"
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
        <AccountPicker
          kind="project"
          label="Receipt project"
          value={project}
          onChange={setProject}
        />
      </div>
      <label>
        Bank or cash reference
        <input
          name="reference"
          required
          maxLength={80}
          defaultValue={item?.reference}
        />
      </label>
      <div className="form-grid">
        <label>
          Receipt date
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
        <label>
          Cash received (PKR)
          <input
            name="cashAmount"
            required
            inputMode="decimal"
            defaultValue={item?.cashAmount}
          />
        </label>
        <label>
          Explicit fee (PKR)
          <input
            value={fee}
            required
            inputMode="decimal"
            onChange={(e) => setFee(e.target.value)}
          />
        </label>
      </div>
      {!/^0(?:\.0{1,2})?$/.test(fee) && (
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
      <label>
        Receipt description
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
          required
          minLength={3}
          maxLength={1000}
          defaultValue={item?.evidence}
        />
      </label>
      {allocations.map((a, i) => (
        <fieldset className="panel" key={a.key}>
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
      <p>
        Invoice settlements must equal cash received plus explicit fees.
        Withholding needs its own reviewed mapping.
      </p>
    </FinanceActionForm>
  );
}
export function CustomerAction({
  item,
  action,
  hosted,
}: {
  item: Customer;
  action: "POST" | "VOID";
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      label={action === "POST" ? "Post receipt" : "Void receipt draft"}
      endpoint={
        "/api/v1/finance/receipts/" + item.id + "/" + action.toLowerCase()
      }
      hosted={hosted}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    >
      <label className="check-label">
        <input type="checkbox" required />I checked the actual cash, fees,
        invoices and posting date.
      </label>
    </FinanceActionForm>
  );
}
