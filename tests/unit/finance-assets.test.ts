import { it, expect } from "vitest";
import {
  assetCreateSchema,
  assetSchemas,
} from "@/modules/finance/assets/schemas";
const body = () => ({
  tag: " eq-001 ",
  description: "Equipment",
  location: "Office",
  billLineId: crypto.randomUUID(),
  cost: "100.01",
  inServiceDate: "2026-01-01",
  usefulLifeMonths: 36,
  reason: "Register purchase",
});
it("normalizes asset tags and requires one actual posted purchase source with exact cost", () => {
  expect(assetCreateSchema.parse(body()).tag).toBe("EQ-001");
  for (const p of [
    { billLineId: null },
    { fundingMovementId: crypto.randomUUID() },
    { cost: 100 },
    { cost: "0" },
    { currency: "USD" },
    { accumulatedDepreciation: "1.00" },
  ])
    expect(assetCreateSchema.safeParse({ ...body(), ...p }).success).toBe(
      false,
    );
});
it("default convention stays pending while confirmation needs a valid month and approval evidence", () => {
  const b = body();
  expect(assetCreateSchema.parse(b).convention).toBe("PENDING");
  expect(assetCreateSchema.parse(b).firstDepMonth).toBeNull();
  for (const p of [
    { firstDepMonth: "2026-01" },
    { convention: "FULL_MONTH_FROM_FIRST_MONTH" },
    {
      convention: "FULL_MONTH_FROM_FIRST_MONTH",
      firstDepMonth: "2025-12",
      policyEvidence: "Reviewed month",
    },
    { residualValue: "100.02" },
    { usefulLifeMonths: 0 },
  ])
    expect(assetCreateSchema.safeParse({ ...b, ...p }).success).toBe(false);
});
it("metadata updates cannot change recognition cost, source or fabricate disposal/depreciation", () => {
  const { billLineId, cost, ...m } = body();
  void billLineId;
  void cost;
  expect(
    assetSchemas.UPDATE.safeParse({ ...m, expectedVersion: 1 }).success,
  ).toBe(true);
  for (const p of [
    { cost: "1.00" },
    { billLineId: crypto.randomUUID() },
    { disposalDate: "2026-02-01" },
    { accumulatedDepreciation: "1.00" },
  ])
    expect(
      assetSchemas.UPDATE.safeParse({ ...m, expectedVersion: 1, ...p }).success,
    ).toBe(false);
});
