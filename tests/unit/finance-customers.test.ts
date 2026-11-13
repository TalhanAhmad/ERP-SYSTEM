import { it, expect } from "vitest";
import { receiptSchema } from "@/modules/finance/receivables/customer/schemas";
const invoiceId = crypto.randomUUID(),
  base = {
    reference: "TEST",
    partyId: crypto.randomUUID(),
    cashAccountId: crypto.randomUUID(),
    documentDate: "2026-01-01",
    postingDate: "2026-01-01",
    description: "Synthetic receipt",
    evidence: "Synthetic bank evidence",
    cashAmount: "9800",
    feeAmount: "200",
    feeAccountId: crypto.randomUUID(),
    allocations: [{ invoiceId, amount: "10000" }],
    reason: "Reviewed synthetic settlement",
  };
it("normalizes exact cash/fee/allocation strings without interpreting withholding as fees", () => {
  expect(receiptSchema.parse(base)).toMatchObject({
    cashAmount: "9800.00",
    feeAmount: "200.00",
    allocations: [{ amount: "10000.00" }],
  });
  expect(
    receiptSchema.safeParse({ ...base, withholdingAmount: "200" }).success,
  ).toBe(false);
});
it("rejects settlement-equation mismatches and duplicate allocations", () => {
  expect(receiptSchema.safeParse({ ...base, cashAmount: "9801" }).success).toBe(
    false,
  );
  expect(
    receiptSchema.safeParse({
      ...base,
      allocations: [
        { invoiceId, amount: "5000" },
        { invoiceId, amount: "5000" },
      ],
    }).success,
  ).toBe(false);
});
it("requires explicit appropriate fee pairing and positive cash and allocation", () => {
  for (const patch of [
    { feeAccountId: null },
    { feeAmount: "0" },
    { cashAmount: "0" },
    { allocations: [{ invoiceId, amount: "0" }] },
  ])
    expect(receiptSchema.safeParse({ ...base, ...patch }).success).toBe(false);
});
it("rejects forged identity/totals/currency and date coercions", () => {
  for (const patch of [
    { number: "RCP-0000000001" },
    { totalAmount: "10000" },
    { currency: "USD" },
    { postingDate: "2025-12-31" },
    { postingDate: "2026-02-30" },
    { cashAmount: 9800 },
  ])
    expect(receiptSchema.safeParse({ ...base, ...patch }).success).toBe(false);
});
