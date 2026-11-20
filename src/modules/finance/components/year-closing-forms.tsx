"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import type { Year, YearPreview, YearDetail } from "../year-closing/types";
export function FiscalYearForm({ hosted }: { hosted: boolean }) {
  const [retained, setRetained] = useState<string | null>(null);
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Create fiscal year"
      endpoint="/api/v1/finance/fiscal-years"
      redirectPrefix="/finance/fiscal-years/"
      business={(f) => ({
        name: String(f.get("name")),
        startDate: String(f.get("startDate")),
        endDate: String(f.get("endDate")),
        retainedAccountId: retained,
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Choose reviewed company dates and an ordinary posting equity account for
        retained earnings. Saved dates and mapping stay fixed; an unused mistake
        can be voided and replaced.
      </p>
      <label>
        Fiscal-year name
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Fiscal-year start
        <input type="date" name="startDate" required />
      </label>
      <label>
        Fiscal-year end
        <input type="date" name="endDate" required />
      </label>
      <AccountPicker
        kind="journal"
        type="EQUITY"
        label="Retained earnings account"
        value={retained}
        onChange={setRetained}
        required
      />
      <label>
        Fiscal calendar and mapping evidence
        <textarea name="evidence" required minLength={3} maxLength={1000} />
      </label>
    </FinanceActionForm>
  );
}
export function YearCloseForm({
  value,
  hosted,
}: {
  value: YearPreview;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Close fiscal year"
      endpoint={`/api/v1/finance/fiscal-years/${value.year.id}/close`}
      submitDisabled={!value.checklist.ready}
      business={(f) => ({
        expectedVersion: value.year.version,
        basisHash: value.basisHash,
        postingFailuresReviewed: f.get("postingFailuresReviewed") === "on",
        pendingAdjustmentsReviewed:
          f.get("pendingAdjustmentsReviewed") === "on",
        postingReviewEvidence: String(f.get("postingReviewEvidence")),
        adjustmentReviewEvidence: String(f.get("adjustmentReviewEvidence")),
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Transfer each remaining income and expense balance to retained earnings,
        save annual statements and close the final accounting period together. A
        year with no remaining balances records its close without a zero-value
        journal.
      </p>
      <label>
        <input type="checkbox" name="postingFailuresReviewed" required /> I
        reviewed failed posting attempts and resolved all failures.
      </label>
      <label>
        Failed-posting review evidence
        <textarea
          name="postingReviewEvidence"
          required
          minLength={3}
          maxLength={1000}
        />
      </label>
      <label>
        <input type="checkbox" name="pendingAdjustmentsReviewed" required /> I
        reviewed adjustments and none remain pending.
      </label>
      <label>
        Adjustment review evidence
        <textarea
          name="adjustmentReviewEvidence"
          required
          minLength={3}
          maxLength={1000}
        />
      </label>
    </FinanceActionForm>
  );
}
export function YearReopenForm({
  value,
  hosted,
}: {
  value: YearDetail;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Reopen fiscal year"
      endpoint={`/api/v1/finance/fiscal-years/${value.year.id}/reopen`}
      business={(f) => ({
        closeId: value.id,
        expectedVersion: value.year.version,
        expectedCloseVersion: value.version,
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Reopen later closed periods and years first. This reverses the original
        closing journal exactly and reopens the final period. Original annual
        statements remain in history; affected issued exports become superseded.
        Earlier periods can then be reopened for adjustments.
      </p>
    </FinanceActionForm>
  );
}
export function YearVoidForm({
  value,
  hosted,
}: {
  value: Year;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Void unused fiscal year"
      endpoint={`/api/v1/finance/fiscal-years/${value.id}/void`}
      business={(f) => ({
        expectedVersion: value.version,
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Only a year with no closing history can be voided. Its original
        configuration remains in history.
      </p>
    </FinanceActionForm>
  );
}
