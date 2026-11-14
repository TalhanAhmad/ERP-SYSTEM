import { it, expect } from "vitest";
import {
  assetMovementSchemas as schemas,
  assetMovementQuerySchema,
  monthSchema,
} from "@/modules/finance/assets/lifecycle/schemas";
const common = {
  assetId: crypto.randomUUID(),
  kind: "IMPAIRMENT",
  postingDate: "2026-01-31",
  description: "Reviewed impairment",
  evidence: "Evidence reference",
  approvalEvidence: "Explicit authorization",
  amount: "100.01",
  reason: "Reviewed asset adjustment",
};
it("asset changes accept exact bounded money and reject floating values, extra precision or journal/cache overrides", () => {
  expect(schemas.CREATE.parse(common).amount).toBe("100.01");
  for (const patch of [
    { amount: 100.01 },
    { amount: "1.001" },
    { amount: "-1.00" },
    { amount: "1000000000000000000.00" },
    { journalId: crypto.randomUUID() },
    { accumulatedDepreciation: "1.00" },
    { kind: "REVERSAL" },
    { kind: "DEPRECIATION" },
  ])
    expect(schemas.CREATE.safeParse({ ...common, ...patch }).success).toBe(
      false,
    );
});
it("month generation rejects impossible or unbounded months and cannot smuggle an amount or fake policy approval", () => {
  const input = {
    assetId: crypto.randomUUID(),
    month: "2026-01",
    postingDate: "2026-01-31",
    expenseAccountId: crypto.randomUUID(),
    accumulatedAccountId: crypto.randomUUID(),
    evidence: "Source evidence",
    approvalEvidence: "Reviewed plan",
    reason: "Draft for review",
  };
  expect(schemas.GENERATE.safeParse(input).success).toBe(true);
  for (const month of ["0000-01", "2026-00", "2026-13", "2026-1", "2026-01\n"])
    expect(monthSchema.safeParse(month).success).toBe(false);
  for (const patch of [
    { amount: "1.00" },
    { approvalEvidence: "" },
    { postingDate: "2026-02-30" },
  ])
    expect(schemas.GENERATE.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
});
it("prospective policy fields and private register filters are bounded and date safe", () => {
  for (const patch of [
    { newLifeMonths: 0 },
    { newLifeMonths: 1.5 },
    { newLifeMonths: 1201 },
    { newResidual: 0.01 },
    { newFirstMonth: "0000-01" },
  ])
    expect(schemas.CREATE.safeParse({ ...common, ...patch }).success).toBe(
      false,
    );
  for (const input of [
    { page: 0 },
    { page: 10001 },
    { state: "PUBLIC" },
    { assetId: "not-an-id" },
    { q: "x".repeat(101) },
    { extra: true },
  ])
    expect(assetMovementQuerySchema.safeParse(input).success).toBe(false);
  expect(
    schemas.REVERSE.safeParse({
      expectedVersion: 1,
      postingDate: "2026-01-31",
      reason: "Correct original",
    }).success,
  ).toBe(true);
  expect(
    schemas.REVERSE.safeParse({
      expectedVersion: 0,
      postingDate: "2026-01-31",
      reason: "Correct original",
    }).success,
  ).toBe(false);
});
