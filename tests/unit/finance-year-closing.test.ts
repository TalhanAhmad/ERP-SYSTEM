import { it, expect } from "vitest";
import {
  yearSchemas,
  yearQuerySchema,
} from "@/modules/finance/year-closing/schemas";
const create = {
  name: "Reviewed company year",
  startDate: "2024-07-01",
  endDate: "2025-06-30",
  retainedAccountId: "11111111-1111-4111-8111-111111111111",
  evidence: "Reviewed fiscal dates and mapping",
  reason: "Explicit owner configuration",
};
it("requires real ordered dates, explicit retained mapping and review evidence", () => {
  expect(yearSchemas.CREATE.parse(create)).toEqual(create);
  for (const patch of [
    { startDate: "2025-02-30" },
    { startDate: "0000-01-01" },
    { endDate: "2024-06-30" },
    { retainedAccountId: "" },
    { evidence: " " },
    { name: "" },
    { reason: " " },
  ])
    expect(yearSchemas.CREATE.safeParse({ ...create, ...patch }).success).toBe(
      false,
    );
});
it.each([
  "ownerId",
  "state",
  "version",
  "lines",
  "netProfit",
  "journalId",
  "reports",
  "canManage",
])("rejects client-supplied %s", (field) => {
  expect(
    yearSchemas.CREATE.safeParse({ ...create, [field]: "forged" }).success,
  ).toBe(false);
});
it("requires both explicit review confirmations and source hash before closing", () => {
  const body = {
    expectedVersion: 1,
    basisHash: "a".repeat(64),
    postingFailuresReviewed: true,
    pendingAdjustmentsReviewed: true,
    postingReviewEvidence: "Reviewed source attempts",
    adjustmentReviewEvidence: "Reviewed annual adjustments",
    reason: "Close reviewed year",
  };
  expect(yearSchemas.CLOSE.parse(body)).toEqual(body);
  for (const patch of [
    { postingFailuresReviewed: false },
    { pendingAdjustmentsReviewed: "true" },
    { basisHash: "x" },
    { expectedVersion: 0 },
    { postingReviewEvidence: "" },
  ])
    expect(yearSchemas.CLOSE.safeParse({ ...body, ...patch }).success).toBe(
      false,
    );
});
it("requires original cycle and exact versions for controlled reopening", () => {
  expect(
    yearSchemas.REOPEN.safeParse({
      closeId: create.retainedAccountId,
      expectedVersion: 2,
      expectedCloseVersion: 1,
      reason: create.reason,
    }).success,
  ).toBe(true);
  expect(
    yearSchemas.REOPEN.safeParse({
      closeId: create.retainedAccountId,
      expectedVersion: 2,
      reason: create.reason,
    }).success,
  ).toBe(false);
  expect(
    yearSchemas.VOID.safeParse({
      expectedVersion: 1,
      reason: create.reason,
      delete: true,
    }).success,
  ).toBe(false);
});
it("bounds register and snapshot pagination without accepting access fields", () => {
  expect(yearQuerySchema.parse({ page: "2" })).toEqual({ page: 2 });
  for (const body of [
    { page: 0 },
    { page: 10001 },
    { page: 1.5 },
    { page: 1, ownerId: create.retainedAccountId },
  ])
    expect(yearQuerySchema.safeParse(body).success).toBe(false);
});
