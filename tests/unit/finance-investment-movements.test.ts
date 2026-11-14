import { it, expect } from "vitest";
import { movementDraftSchema } from "@/modules/finance/treasury/schemas";
const body = () => ({
  kind: "INVESTMENT_DISPOSAL",
  holdingId: crypto.randomUUID(),
  amount: "0.00",
  feeAmount: "0.00",
  allocations: [{ lotId: crypto.randomUUID(), disposeAll: true }],
  reference: "D1",
  documentDate: "2026-01-01",
  postingDate: "2026-01-01",
  description: "Retirement",
  evidence: "Reviewed retirement",
  reason: "Reviewed disposal",
});
it("zero-proceeds disposal requires explicit lots while ordinary movements stay positive", () => {
  expect(movementDraftSchema.safeParse(body()).success).toBe(true);
  for (const p of [
    { allocations: [] },
    { kind: "INVESTMENT_INCOME_ACCRUAL", allocations: [] },
    { currency: "USD" },
  ])
    expect(movementDraftSchema.safeParse({ ...body(), ...p }).success).toBe(
      false,
    );
});
it("disposal fees and cash source remain distinct and duplicate lots are rejected", () => {
  const b = body();
  expect(
    movementDraftSchema.safeParse({
      ...b,
      amount: "1.00",
      feeAmount: "2.00",
      toCashId: crypto.randomUUID(),
    }).success,
  ).toBe(true);
  expect(
    movementDraftSchema.safeParse({
      ...b,
      allocations: [...b.allocations, ...b.allocations],
    }).success,
  ).toBe(false);
  expect(
    movementDraftSchema.safeParse({ ...b, feeAmount: "1.001" }).success,
  ).toBe(false);
});
it("reviewed value changes require explicit approval, lot amounts and an exact total without cash", () => {
  const b = {
    ...body(),
    kind: "INVESTMENT_IMPAIRMENT",
    amount: "10.01",
    approvalEvidence: "Accountant reference",
    allocations: [{ lotId: crypto.randomUUID(), carryingAmount: "10.01" }],
  };
  expect(movementDraftSchema.safeParse(b).success).toBe(true);
  for (const p of [
    { approvalEvidence: null },
    { amount: "10.02" },
    { toCashId: crypto.randomUUID() },
  ])
    expect(movementDraftSchema.safeParse({ ...b, ...p }).success).toBe(false);
});
