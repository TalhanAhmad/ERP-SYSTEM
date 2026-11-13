import { it, expect } from "vitest";
import { taxCodeSchema } from "@/modules/finance/taxes/schemas";
import { invoiceLineSchema } from "@/modules/finance/receivables/schemas";
import { receiptSchema } from "@/modules/finance/receivables/customer/schemas";
const u = () => crypto.randomUUID();
const policy = () => ({
  code: "SYNTHETIC",
  name: "Reviewed test only",
  kind: "INDIRECT",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  rate: "10.000001",
  mode: "EXCLUSIVE",
  rounding: "HALF_UP",
  inputAccountId: u(),
  outputAccountId: u(),
  policyEvidence: "Synthetic company-reviewed policy",
  reason: "Reviewed synthetic mapping",
});
it("tax policies require explicit dates, decimal-string rate, rounding and separate controls", () => {
  expect(taxCodeSchema.safeParse(policy()).success).toBe(true);
  for (const patch of [
    { rate: 10 },
    { rate: "1000.000001" },
    { rate: "0.01\n" },
    { effectiveTo: "2025-12-31" },
    { rounding: "GUESS" },
    { kind: "WITHHOLDING", mode: "INCLUSIVE" },
  ])
    expect(taxCodeSchema.safeParse({ ...policy(), ...patch }).success).toBe(
      false,
    );
  const p = policy();
  expect(
    taxCodeSchema.safeParse({ ...p, outputAccountId: p.inputAccountId })
      .success,
  ).toBe(false);
});
it("source lines accept only a tax policy ID, never client-computed tax or snapshots", () => {
  const l = {
    description: "Service",
    quantity: "1",
    unitRate: "100",
    recognition: "EARNED",
    revenueAccountId: u(),
    taxCodeId: u(),
  };
  expect(invoiceLineSchema.safeParse(l).success).toBe(true);
  for (const patch of [
    { taxAmount: "1" },
    { taxSnapshot: { rate: "1" } },
    { taxAccountId: u() },
  ])
    expect(invoiceLineSchema.safeParse({ ...l, ...patch }).success).toBe(false);
});
it("evidenced withholding participates in settlement capacity and requires its policy", () => {
  const r = {
    reference: "Synthetic",
    partyId: u(),
    cashAccountId: u(),
    documentDate: "2026-01-01",
    postingDate: "2026-01-01",
    description: "Reviewed collection",
    evidence: "Certificate",
    reason: "Reviewed collection",
    cashAmount: "98",
    feeAmount: "0",
    withholdingAmount: "2",
    withholdingCodeId: u(),
    allocations: [{ invoiceId: u(), amount: "100" }],
  };
  expect(receiptSchema.safeParse(r).success).toBe(true);
  expect(
    receiptSchema.safeParse({ ...r, withholdingCodeId: null }).success,
  ).toBe(false);
  expect(
    receiptSchema.safeParse({ ...r, withholdingAmount: "1.99" }).success,
  ).toBe(false);
  expect(
    receiptSchema.safeParse({ ...r, cashAmount: "0", withholdingAmount: "100" })
      .success,
  ).toBe(true);
});
