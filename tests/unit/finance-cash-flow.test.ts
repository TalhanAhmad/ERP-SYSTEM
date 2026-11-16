import { it, expect } from "vitest";
import {
  cashFlowQuerySchema,
  cashFlowReviewQuerySchema,
  cashFlowConfirmSchema,
} from "@/modules/finance/reports/cash-flow/schemas";
it("cash-flow filters enforce real inclusive dates and bounded pages without accepting readiness assertions", () => {
  expect(
    cashFlowQuerySchema.safeParse({
      from: "0001-01-01",
      to: "9999-12-31",
      page: "2",
    }).success,
  ).toBe(true);
  for (const b of [
    { from: "2026-02-30", to: "2026-11-15" },
    { from: "2026-11-16", to: "2026-11-15" },
    { from: "0001-01-01", to: "9999-12-31", classificationReady: true },
    { from: "0001-01-01", to: "9999-12-31", page: 10001 },
  ])
    expect(cashFlowQuerySchema.safeParse(b).success).toBe(false);
  expect(
    cashFlowReviewQuerySchema.safeParse({
      journalId: crypto.randomUUID(),
      page: 0,
    }).success,
  ).toBe(false);
});
const body = () => ({
  journalId: crypto.randomUUID(),
  basisHash: "a".repeat(64),
  expectedReviewId: null,
  expectedVersion: null,
  components: [
    {
      journalLineId: crypto.randomUUID(),
      category: "OPERATING",
      amount: "98.01",
    },
  ],
  evidence: "Actual source purpose reviewed",
  reason: "Explicit cash components",
});
it("review components require exact positive decimal amounts, actual IDs and reviewed categories", () => {
  const b = body();
  expect(cashFlowConfirmSchema.safeParse(b).success).toBe(true);
  for (const extra of [
    { amount: 98.01 },
    { amount: "0.00" },
    { amount: "98.001" },
    { amount: "-98.01" },
    { category: "NONCASH" },
    { journalLineId: "guessed" },
    { signedAmount: "-98.01" },
  ])
    expect(
      cashFlowConfirmSchema.safeParse({
        ...b,
        components: [{ ...b.components[0], ...extra }],
      }).success,
    ).toBe(false);
});
it("confirmation is bounded and never accepts an account, source amount, actor or final-export flag from the caller", () => {
  const b = body();
  for (const extra of [
    { components: [] },
    { components: Array(801).fill(b.components[0]) },
    { expectedVersion: 3 },
    { ownerId: crypto.randomUUID() },
    { cashBalance: "100.00" },
    { finalExportEligible: true },
  ])
    expect(cashFlowConfirmSchema.safeParse({ ...b, ...extra }).success).toBe(
      false,
    );
});
