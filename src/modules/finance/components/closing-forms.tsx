"use client";
import { FinanceActionForm } from "./finance-action-form";
import { closeReportTypes } from "../closing/schemas";
import type { ClosePreview, CloseDetail, CloseIssue } from "../closing/types";
import { reportLabels } from "../reports/exports/schemas";
export function PeriodCloseForm({
  value,
  hosted,
}: {
  value: ClosePreview;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Close reviewed period"
      endpoint={`/api/v1/finance/periods/${value.period.id}/close`}
      redirectPrefix={`/finance/periods/${value.period.id}/closes/`}
      submitDisabled={!value.checklist.ready}
      business={(f) => ({
        expectedVersion: value.period.version,
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
        Closing saves the reviewed checklist and complete trial balance, profit
        and loss, and balance sheet. It protects the period and earlier balances
        from further posting. No closing journal is created.
      </p>
      <label>
        <input type="checkbox" name="postingFailuresReviewed" required /> I
        reviewed failed posting attempts and there are no unresolved failures.
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
        reviewed adjustments and no required adjustment is pending.
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
export function PeriodReopenForm({
  value,
  hosted,
}: {
  value: CloseDetail;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Reopen closed period"
      endpoint={`/api/v1/finance/periods/${value.period.id}/reopen`}
      business={(f) => ({
        closeId: value.id,
        expectedVersion: value.period.version,
        expectedCloseVersion: value.version,
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Reopen later closed periods first. The original checklist and reports
        remain in history. Affected issued exports become superseded; unfinished
        exports are cancelled. Review and close again after corrections.
      </p>
    </FinanceActionForm>
  );
}
export function CloseExportForm({
  value,
  hosted,
}: {
  value: CloseDetail;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Prepare closed-statement export"
      endpoint={`/api/v1/finance/periods/${value.period.id}/closes/${value.id}/exports`}
      redirectPrefix="/finance/exports/"
      business={(f) => ({
        reportType: String(f.get("reportType")),
        reason: String(f.get("reason")),
      })}
    >
      <label>
        Saved statement
        <select name="reportType">
          {closeReportTypes.map((t) => (
            <option key={t} value={t}>
              {reportLabels[t]}
            </option>
          ))}
        </select>
      </label>
      <p>
        The CSV and PDF use the original saved close statement. Download
        availability lasts 24 hours; a fresh authorized copy can be requested
        while this close remains current.
      </p>
    </FinanceActionForm>
  );
}
export function CloseIssueCreateForm({
  periodId,
  hosted,
}: {
  periodId: string;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Record review issue"
      endpoint={`/api/v1/finance/periods/${periodId}/close-issues`}
      business={(f) => ({
        kind: String(f.get("kind")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      <label>
        Issue type
        <select name="kind">
          <option value="POSTING_FAILURE">Unresolved posting failure</option>
          <option value="PENDING_ADJUSTMENT">Pending adjustment</option>
        </select>
      </label>
      <label>
        Issue description
        <textarea name="description" required minLength={3} maxLength={500} />
      </label>
      <label>
        Source or review evidence
        <textarea name="evidence" required minLength={3} maxLength={1000} />
      </label>
    </FinanceActionForm>
  );
}
export function CloseIssueResolveForm({
  issue,
  hosted,
}: {
  issue: CloseIssue;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Resolve review issue"
      endpoint={`/api/v1/finance/periods/${issue.periodId}/close-issues/${issue.id}/resolve`}
      business={(f) => ({
        expectedVersion: issue.version,
        resolution: String(f.get("resolution")),
        reason: String(f.get("reason")),
      })}
    >
      <label>
        Resolution evidence
        <textarea name="resolution" required minLength={3} maxLength={1000} />
      </label>
    </FinanceActionForm>
  );
}
