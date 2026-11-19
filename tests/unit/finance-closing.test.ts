import { it, expect } from "vitest";
import {
  closeSchemas,
  closeQuerySchema,
} from "@/modules/finance/closing/schemas";
const body = {
  expectedVersion: 1,
  basisHash: "a".repeat(64),
  postingFailuresReviewed: true,
  pendingAdjustmentsReviewed: true,
  postingReviewEvidence: "Reviewed failed posting attempts and source outcomes",
  adjustmentReviewEvidence: "Reviewed all required period adjustments",
  reason: "Close reviewed accounting period",
};
it("close requires genuine booleans, both review evidence fields and an exact source fingerprint", () => {
  expect(closeSchemas.CLOSE.parse(body)).toEqual(body);
  for (const patch of [
    { postingFailuresReviewed: false },
    { pendingAdjustmentsReviewed: false },
    { postingFailuresReviewed: "true" },
    { postingReviewEvidence: "" },
    { adjustmentReviewEvidence: "  " },
    { basisHash: "x" },
    { expectedVersion: 0 },
    { expectedVersion: 1.5 },
  ])
    expect(closeSchemas.CLOSE.safeParse({ ...body, ...patch }).success).toBe(
      false,
    );
});
it.each([
  "actorId",
  "ownerId",
  "ready",
  "reports",
  "closedAt",
  "periodId",
  "closeId",
  "snapshotHash",
])("rejects caller-supplied close control %s", (key) => {
  expect(closeSchemas.CLOSE.safeParse({ ...body, [key]: true }).success).toBe(
    false,
  );
});
it("reopening binds the original retained close and both current versions without changing reporting dates", () => {
  const value = {
    closeId: crypto.randomUUID(),
    expectedVersion: 2,
    expectedCloseVersion: 1,
    reason: "Reviewed period correction",
  };
  expect(closeSchemas.REOPEN.safeParse(value).success).toBe(true);
  for (const patch of [
    { closeId: "guessed" },
    { expectedCloseVersion: 0 },
    { from: "2026-01-01" },
    { snapshot: {} },
    { reason: "" },
  ])
    expect(closeSchemas.REOPEN.safeParse({ ...value, ...patch }).success).toBe(
      false,
    );
});
it("closed-copy requests select only saved statements and cannot inject replacement filters or readiness", () => {
  for (const reportType of ["TRIAL_BALANCE", "PROFIT_LOSS", "BALANCE_SHEET"])
    expect(
      closeSchemas.EXPORT.safeParse({
        reportType,
        reason: "Copy original closed statement",
      }).success,
    ).toBe(true);
  for (const patch of [
    { reportType: "GENERAL_LEDGER" },
    { filters: { q: "hide source" } },
    { closeId: crypto.randomUUID() },
    { readiness: { finalEligible: true } },
  ])
    expect(
      closeSchemas.EXPORT.safeParse({
        reportType: "TRIAL_BALANCE",
        reason: "Copy original source",
        ...patch,
      }).success,
    ).toBe(false);
});
it("review issues retain explicit evidence and resolve by version without accepting ledger amounts", () => {
  const value = {
    kind: "POSTING_FAILURE",
    description: "Original source needs correction",
    evidence: "Source review and actual failed outcome",
    reason: "Record pending review",
  };
  expect(closeSchemas.ISSUE_CREATE.safeParse(value).success).toBe(true);
  expect(
    closeSchemas.ISSUE_CREATE.safeParse({ ...value, amount: "100.00" }).success,
  ).toBe(false);
  expect(
    closeSchemas.ISSUE_RESOLVE.safeParse({
      expectedVersion: 1,
      resolution: "Corrected and verified original posting",
      reason: "Resolve source issue",
    }).success,
  ).toBe(true);
  expect(
    closeSchemas.ISSUE_RESOLVE.safeParse({
      expectedVersion: 1,
      resolution: "x",
      reason: "Resolve source",
    }).success,
  ).toBe(false);
});
it("private close pagination is bounded and rejects other query controls", () => {
  expect(closeQuerySchema.parse({ page: "2" })).toEqual({ page: 2 });
  for (const v of [
    { page: 0 },
    { page: 10001 },
    { page: "NaN" },
    { page: 1, actorId: crypto.randomUUID() },
  ])
    expect(closeQuerySchema.safeParse(v).success).toBe(false);
});
