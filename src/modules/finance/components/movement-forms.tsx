"use client";
import { useState } from "react";
import type { movementDetail } from "../treasury/service";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
type Movement = Awaited<ReturnType<typeof movementDetail>>["item"];
export function MovementForm({
  item,
  hosted,
}: {
  item?: Movement;
  hosted: boolean;
}) {
  const [from, setFrom] = useState(item?.fromCashId ?? null),
    [to, setTo] = useState(item?.toCashId ?? null);
  return (
    <FinanceActionForm
      label={item ? "Save movement draft" : "Create transfer draft"}
      hosted={hosted}
      endpoint={"/api/v1/finance/movements" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/movements/"}
      business={(f) => ({
        kind: "TRANSFER",
        reference: String(f.get("reference")),
        documentDate: String(f.get("documentDate")),
        postingDate: String(f.get("postingDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        amount: String(f.get("amount")),
        currency: "PKR",
        fromCashId: from,
        toCashId: to,
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <div className="form-grid">
        <AccountPicker
          kind="cash-account"
          label="Transfer from"
          value={from}
          onChange={setFrom}
          required
          initial={
            item?.fromCash && item.fromCashId
              ? [{ id: item.fromCashId, code: "", name: item.fromCash.name }]
              : []
          }
        />
        <AccountPicker
          kind="cash-account"
          label="Transfer to"
          value={to}
          onChange={setTo}
          required
          initial={
            item?.toCash && item.toCashId
              ? [{ id: item.toCashId, code: "", name: item.toCash.name }]
              : []
          }
        />
        <label>
          Amount (PKR)
          <input
            name="amount"
            inputMode="decimal"
            required
            defaultValue={item?.amount}
          />
        </label>
        <label>
          Transfer reference
          <input
            name="reference"
            required
            maxLength={80}
            defaultValue={item?.reference}
          />
        </label>
        <label>
          Document date
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
      </div>
      <label>
        Movement description
        <textarea
          name="description"
          required
          maxLength={1000}
          defaultValue={item?.description}
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
      <p>
        Record a completed transfer between two company bank/cash accounts. Both
        ledger legs post together. This records the movement; it does not
        initiate a bank transfer.
      </p>
    </FinanceActionForm>
  );
}
export function MovementAction({
  item,
  action,
  hosted,
}: {
  item: Movement;
  action: "POST" | "VOID" | "REVERSE";
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      label={
        action === "POST"
          ? "Post movement"
          : action === "VOID"
            ? "Void movement draft"
            : "Reverse movement"
      }
      hosted={hosted}
      endpoint={
        "/api/v1/finance/movements/" + item.id + "/" + action.toLowerCase()
      }
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
        ...(action === "REVERSE"
          ? { postingDate: String(f.get("postingDate")) }
          : {}),
      })}
    >
      {action === "REVERSE" && (
        <label>
          Reversal posting date
          <input
            name="postingDate"
            type="date"
            required
            defaultValue={item.postingDate}
          />
        </label>
      )}
      <label className="check-label">
        <input type="checkbox" required />I reviewed both accounts, the amount,
        evidence and accounting date.
      </label>
    </FinanceActionForm>
  );
}
