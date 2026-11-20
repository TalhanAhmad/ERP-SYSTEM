"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import { AutomationPicker } from "./automation-picker";
import type { Recognition } from "../automation/types";
export function RecurringCreateForm({ hosted }: { hosted: boolean }) {
  const [kind, setKind] = useState("BILL"),
    [party, setParty] = useState<string | null>(null),
    [payable, setPayable] = useState<string | null>(null),
    [debit, setDebit] = useState<string | null>(null),
    [credit, setCredit] = useState<string | null>(null),
    [asset, setAsset] = useState<string | null>(null),
    [project, setProject] = useState<string | null>(null);
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Create recurring draft schedule"
      endpoint="/api/v1/finance/automation"
      redirectPrefix="/finance/automation/"
      business={(f) => ({
        name: String(f.get("name")),
        kind,
        startMonth: String(f.get("startMonth")),
        endMonth: String(f.get("endMonth")) || null,
        day: Number(f.get("day")),
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
        template: {
          description: String(f.get("description")),
          ...(kind === "BILL"
            ? {
                partyId: party,
                payableAccountId: payable,
                costAccountId: debit,
                amount: String(f.get("amount")),
                dueDays: Number(f.get("dueDays")),
                projectId: project,
              }
            : kind === "JOURNAL"
              ? {
                  debitAccountId: debit,
                  creditAccountId: credit,
                  amount: String(f.get("amount")),
                  projectId: project,
                }
              : {
                  assetId: asset,
                  expenseAccountId: debit,
                  accumulatedAccountId: credit,
                }),
        },
      })}
    >
      <p>
        Prepare monthly drafts for independent review. A schedule never posts a
        journal or records a payment. Fixed bill drafts do not add tax; review
        actual supplier documents before posting.
      </p>
      <label>
        Schedule name
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Draft type
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setDebit(null);
            setCredit(null);
          }}
        >
          <option value="BILL">Rent or subscription bill</option>
          <option value="JOURNAL">
            Accrual or prepaid recognition journal
          </option>
          <option value="DEPRECIATION">Reviewed monthly depreciation</option>
        </select>
      </label>
      <label>
        First month
        <input type="month" name="startMonth" required />
      </label>
      <label>
        Last month (optional)
        <input type="month" name="endMonth" />
      </label>
      <label>
        Day of month
        <input
          type="number"
          name="day"
          min={1}
          max={28}
          defaultValue={1}
          required
        />
      </label>
      <label>
        Description
        <input name="description" required minLength={3} maxLength={500} />
      </label>
      <label>
        Reviewed policy and source evidence
        <textarea name="evidence" required minLength={3} maxLength={1000} />
      </label>
      {kind === "BILL" && (
        <>
          <AccountPicker
            kind="supplier"
            label="Supplier"
            value={party}
            onChange={setParty}
            required
          />
          <AccountPicker
            kind="payable"
            label="Payable account"
            value={payable}
            onChange={setPayable}
            required
          />
          <label>
            Payment terms (days)
            <input
              type="number"
              name="dueDays"
              min={0}
              max={90}
              defaultValue={0}
              required
            />
          </label>
        </>
      )}
      {kind === "DEPRECIATION" && (
        <AutomationPicker
          kind="ASSET"
          label="Asset"
          value={asset}
          onChange={setAsset}
        />
      )}
      <AccountPicker
        key={kind + "debit"}
        kind={
          kind === "BILL"
            ? "cost"
            : kind === "DEPRECIATION"
              ? "asset-expense"
              : "journal"
        }
        label={kind === "JOURNAL" ? "Debit account" : "Expense account"}
        value={debit}
        onChange={setDebit}
        required
      />
      {kind !== "BILL" && (
        <AccountPicker
          key={kind + "credit"}
          kind={
            kind === "DEPRECIATION" ? "accumulated-depreciation" : "journal"
          }
          label={
            kind === "DEPRECIATION"
              ? "Accumulated depreciation account"
              : "Credit account"
          }
          value={credit}
          onChange={setCredit}
          required
        />
      )}
      {kind !== "DEPRECIATION" && (
        <>
          <label>
            Monthly amount (PKR)
            <input name="amount" inputMode="decimal" required />
          </label>
          <AccountPicker
            kind="project"
            label="Project (optional)"
            value={project}
            onChange={setProject}
          />
        </>
      )}
    </FinanceActionForm>
  );
}
export function AutomationChange({
  hosted,
  action,
  id,
  version,
}: {
  hosted: boolean;
  action: "PAUSE" | "RESUME" | "RETRY" | "PREPARE";
  id?: string;
  version?: number;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={
        action === "PREPARE"
          ? "Prepare due drafts"
          : action === "RETRY"
            ? "Retry failed preparation"
            : action === "PAUSE"
              ? "Pause schedule"
              : "Resume schedule"
      }
      endpoint={
        action === "PREPARE"
          ? "/api/v1/finance/automation/prepare"
          : action === "RETRY"
            ? `/api/v1/finance/automation/runs/${id}/retry`
            : `/api/v1/finance/automation/${id}/${action.toLowerCase()}`
      }
      business={(f) => ({
        ...(action === "PREPARE" ? {} : { expectedVersion: version }),
        reason: String(f.get("reason")),
      })}
    >
      <p>
        {action === "PREPARE"
          ? "Prepare at most three due monthly drafts per pass. Review and post each source separately."
          : action === "RETRY"
            ? "Review the cause before retrying. Original attempts remain retained; total attempts are bounded to nine with explicit owner review."
            : "Completed drafts and attempt history remain retained. Resuming does not revive cancelled months or revoked grants."}
      </p>
    </FinanceActionForm>
  );
}
export function RecognitionCreateForm({ hosted }: { hosted: boolean }) {
  const [date, setDate] = useState(""),
    [line, setLine] = useState<string | null>(null);
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Create recognition draft"
      endpoint="/api/v1/finance/recognitions"
      redirectPrefix="/finance/recognitions/"
      business={(f) => ({
        invoiceLineId: line,
        postingDate: date,
        amount: String(f.get("amount")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Recognize only an evidenced delivered portion of a posted deferred
        invoice. This moves deferred revenue to earned revenue without new
        receivables or cash.
      </p>
      <label>
        Recognition date
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setLine(null);
          }}
          required
        />
      </label>
      <AutomationPicker
        kind="DEFERRED"
        label="Deferred invoice line"
        asOf={date}
        value={line}
        onChange={setLine}
      />
      <label>
        Amount to recognize (PKR)
        <input name="amount" inputMode="decimal" required />
      </label>
      <label>
        Description
        <input name="description" required minLength={3} maxLength={500} />
      </label>
      <label>
        Delivered service approval evidence
        <textarea name="evidence" required minLength={3} maxLength={1000} />
      </label>
    </FinanceActionForm>
  );
}
export function RecognitionChange({
  hosted,
  item,
  action,
}: {
  hosted: boolean;
  item: Recognition;
  action: "POST" | "VOID" | "REVERSE";
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={
        action === "POST"
          ? "Post reviewed recognition"
          : action === "VOID"
            ? "Void recognition draft"
            : "Reverse recognition"
      }
      endpoint={`/api/v1/finance/recognitions/${item.id}/${action.toLowerCase()}`}
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
            type="date"
            name="postingDate"
            min={item.postingDate.slice(0, 10)}
            required
          />
        </label>
      )}
      <p>
        {action === "POST"
          ? "Check original service evidence and amount. Current and future deferred balances are checked again atomically."
          : action === "REVERSE"
            ? "Post an exact dated opposite. Original source and earlier reports remain retained."
            : "Retain the unposted draft and its evidence."}
      </p>
    </FinanceActionForm>
  );
}
export function OpeningCreditForm({
  hosted,
  side,
  documentId,
  version,
}: {
  hosted: boolean;
  side: "CUSTOMER" | "SUPPLIER";
  documentId: string;
  version: number;
}) {
  const [offset, setOffset] = useState<string | null>(null);
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Approve opening credit classification"
      endpoint="/api/v1/finance/opening-credit-reviews"
      business={(f) => ({
        side,
        documentId,
        expectedVersion: version,
        offsetAccountId: offset,
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      <p>
        This credit changes an imported unpaid balance. Review its
        opening-equity offset; opening clearing and current sales/costs must
        remain unchanged. Changing the draft requires a new owner review.
      </p>
      <AutomationPicker
        kind="EQUITY"
        label="Reviewed opening equity offset"
        value={offset}
        onChange={setOffset}
      />
      <label>
        Opening credit review evidence
        <textarea name="evidence" required minLength={3} maxLength={1000} />
      </label>
    </FinanceActionForm>
  );
}
