import { it, expect } from "vitest";
import {
  paymentSchema,
  supplierSchemas,
} from "@/modules/finance/payables/supplier/schemas";
const u = () => crypto.randomUUID();
const base = () => ({
  reference: "SUP-TEST",
  partyId: u(),
  documentDate: "2026-01-01",
  postingDate: "2026-01-01",
  description: "Reviewed supplier settlement",
  evidence: "Synthetic evidence",
  reason: "Reviewed input",
  cashAccountId: u(),
  cashAmount: "10.00",
  feeAmount: "0.00",
  allocations: [{ billId: u(), amount: "10.00" }],
});
it("requires supplier payment amount to settle bills or an explicitly mapped advance", () => {
  expect(paymentSchema.safeParse(base()).success).toBe(true);
  expect(paymentSchema.safeParse({ ...base(), allocations: [] }).success).toBe(
    false,
  );
  expect(
    paymentSchema.safeParse({
      ...base(),
      allocations: [],
      advanceAccountId: u(),
    }).success,
  ).toBe(true);
  expect(
    paymentSchema.safeParse({
      ...base(),
      allocations: [{ billId: u(), amount: "10.01" }],
    }).success,
  ).toBe(false);
});
it("rejects unsupported supplier fee mapping, foreign fields and duplicate bill allocations", () => {
  expect(
    paymentSchema.safeParse({ ...base(), feeAmount: "0.01", feeAccountId: u() })
      .success,
  ).toBe(false);
  expect(paymentSchema.safeParse({ ...base(), invoiceId: u() }).success).toBe(
    false,
  );
  const b = base();
  expect(
    paymentSchema.safeParse({
      ...b,
      allocations: [b.allocations[0], b.allocations[0]],
    }).success,
  ).toBe(false);
});
it("keeps source-bound supplier credits/refunds strict and corrections versioned", () => {
  const { cashAmount, cashAccountId, feeAmount, allocations, ...common } =
    base();
  void feeAmount;
  void allocations;
  expect(
    supplierSchemas("SUPPLIER_REFUND").CREATE.safeParse({
      ...common,
      cashAmount,
      cashAccountId,
      sourceDocumentId: u(),
    }).success,
  ).toBe(true);
  expect(
    supplierSchemas("SUPPLIER_CREDIT").CREATE.safeParse({
      ...common,
      billId: u(),
      advanceAccountId: u(),
      creditLines: [{ billLineId: u(), amount: "0.00" }],
    }).success,
  ).toBe(false);
  expect(
    supplierSchemas("PAYMENT").REVERSE.safeParse({
      expectedVersion: 2,
      postingDate: "2026-01-01",
      reason: "Undo posted source",
    }).success,
  ).toBe(true);
});
