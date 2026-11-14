"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import { fundingKinds } from "../treasury/kinds";
import type { movementDetail } from "../treasury/service";
type Movement = Awaited<ReturnType<typeof movementDetail>>["item"];
export function FundingForm({
  item,
  hosted,
}: {
  item?: Movement;
  hosted: boolean;
}) {
  const [kind, setKind] = useState(item?.kind ?? "CAPITAL_CONTRIBUTION"),
    [party, setParty] = useState(item?.partyId ?? null),
    [control, setControl] = useState(item?.controlAccountId ?? null),
    [bank, setBank] = useState(item?.fromCashId ?? item?.toCashId ?? null),
    [counter, setCounter] = useState(item?.counterAccountId ?? null),
    [bill, setBill] = useState(item?.billId ?? null);
  const incoming = kind === "CAPITAL_CONTRIBUTION",
    outgoing = [
      "CAPITAL_RETURN",
      "DISTRIBUTION",
      "FOUNDER_REIMBURSEMENT",
    ].includes(kind),
    noncash = !incoming && !outgoing,
    approval = ["CAPITAL_RETURN", "DISTRIBUTION", "NONCASH_CAPITAL"].includes(
      kind,
    ),
    controlKind =
      kind === "DISTRIBUTION"
        ? "distribution"
        : [
              "CAPITAL_CONTRIBUTION",
              "CAPITAL_RETURN",
              "NONCASH_CAPITAL",
            ].includes(kind)
          ? "capital"
          : "founder-payable";
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save funding draft" : "Create funding draft"}
      endpoint={"/api/v1/finance/movements" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/movements/"}
      business={(f) => ({
        kind,
        reference: String(f.get("reference")),
        documentDate: String(f.get("documentDate")),
        postingDate: String(f.get("postingDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        currency: "PKR",
        amount: String(f.get("amount")),
        partyId: party,
        controlAccountId: control,
        counterAccountId: noncash ? counter : null,
        fromCashId: outgoing ? bank : null,
        toCashId: incoming ? bank : null,
        billId: kind === "FOUNDER_BILL_SETTLEMENT" ? bill : null,
        approvalEvidence: approval ? String(f.get("approvalEvidence")) : null,
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <label>
        Funding classification
        <select
          value={kind}
          disabled={!!item}
          onChange={(e) => {
            setKind(e.target.value);
            setControl(null);
            setCounter(null);
            setBill(null);
          }}
        >
          {fundingKinds.map((k) => (
            <option key={k} value={k}>
              {k.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <AccountPicker
        kind="contributor"
        label="Contributor"
        value={party}
        onChange={setParty}
        required
        initial={
          item?.party && party
            ? [{ id: party, code: "", name: item.party.name }]
            : []
        }
      />
      <AccountPicker
        key={controlKind}
        kind={controlKind}
        label="Funding control account"
        value={control}
        onChange={setControl}
        required
        initial={
          item?.controlAccount && control
            ? [{ id: control, ...item.controlAccount }]
            : []
        }
      />
      {!noncash && (
        <AccountPicker
          kind="cash-account"
          label={incoming ? "Receiving bank or cash" : "Paying bank or cash"}
          value={bank}
          onChange={setBank}
          required
          initial={
            item && bank
              ? [
                  {
                    id: bank,
                    code: "",
                    name:
                      item.fromCash?.name ??
                      item.toCash?.name ??
                      "Selected bank",
                  },
                ]
              : []
          }
        />
      )}
      {noncash && (
        <AccountPicker
          kind={
            kind === "FOUNDER_BILL_SETTLEMENT"
              ? "payable"
              : kind === "NONCASH_CAPITAL"
                ? "funding-asset"
                : "funding-cost"
          }
          label="Reviewed debit account"
          value={counter}
          onChange={setCounter}
          required
          initial={
            item?.counterAccount && counter
              ? [{ id: counter, ...item.counterAccount }]
              : []
          }
        />
      )}
      {kind === "FOUNDER_BILL_SETTLEMENT" && (
        <AccountPicker
          kind="funding-bill"
          label="Posted company bill"
          value={bill}
          onChange={setBill}
          required
          initial={
            item?.bill && bill
              ? [{ id: bill, code: item.bill.number, name: "Company bill" }]
              : []
          }
        />
      )}
      <div className="form-grid">
        <label>
          Amount (PKR)
          <input
            name="amount"
            required
            inputMode="decimal"
            defaultValue={item?.amount}
          />
        </label>
        <label>
          External reference
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
            type="date"
            name="documentDate"
            required
            defaultValue={item?.documentDate}
          />
        </label>
        <label>
          Posting date
          <input
            type="date"
            name="postingDate"
            required
            defaultValue={item?.postingDate}
          />
        </label>
      </div>
      <label>
        Funding description
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
      {approval && (
        <label>
          Authorization or noncash review evidence
          <textarea
            name="approvalEvidence"
            required
            minLength={3}
            maxLength={1000}
            defaultValue={item?.approvalEvidence ?? ""}
          />
        </label>
      )}
      <p>
        Capital, distributions and reimbursable personal outlays stay separate.
        Founder-paid bills clear the original payable. Record an approved
        transaction; ownership percentages and distribution availability are not
        calculated.
      </p>
    </FinanceActionForm>
  );
}
