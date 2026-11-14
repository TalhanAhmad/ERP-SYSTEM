import { it, expect } from "vitest";
import {
  billDraftSchema,
  calculateBill,
} from "@/modules/finance/payables/schemas";
const uuid = () => crypto.randomUUID();
const body = () => ({
  kind: "BILL",
  reference: "SUP-001",
  partyId: uuid(),
  payableAccountId: uuid(),
  billDate: "2026-01-01",
  postingDate: "2026-01-01",
  dueDate: "2026-02-01",
  description: "Manual cost",
  evidence: "Supplier evidence",
  reason: "Reviewed cost",
  lines: [
    {
      description: "Cost",
      quantity: "3",
      unitRate: "1.005",
      discountAmount: "0.02",
      treatment: "EXPENSE",
      costAccountId: uuid(),
    },
  ],
});
it("rounds cost lines before discounts using exact decimal strings", () => {
  expect(calculateBill(body().lines).totalAmount).toBe("3.00");
  expect(
    calculateBill([
      { quantity: "1", unitRate: "99999999999999.999999", discountAmount: "0" },
    ]).totalAmount,
  ).toBe("100000000000000.00");
});
it("separates payable and paid-now inputs and rejects unsupported fields", () => {
  expect(billDraftSchema.parse(body()).cashAccountId).toBeNull();
  expect(
    billDraftSchema.safeParse({ ...body(), cashAccountId: uuid() }).success,
  ).toBe(false);
  expect(
    billDraftSchema.safeParse({
      ...body(),
      kind: "EXPENSE",
      payableAccountId: null,
      cashAccountId: uuid(),
    }).success,
  ).toBe(true);
  expect(billDraftSchema.safeParse({ ...body(), payroll: true }).success).toBe(
    false,
  );
});
it("requires references, valid dates, bounded quantities and discounts", () => {
  for (const patch of [
    { reference: "" },
    { postingDate: "2025-12-31" },
    { dueDate: "2025-12-31" },
    { lines: [{ ...body().lines[0], discountAmount: "999" }] },
    { lines: [{ ...body().lines[0], quantity: 2 }] },
    { lines: [] },
  ])
    expect(billDraftSchema.safeParse({ ...body(), ...patch }).success).toBe(
      false,
    );
});
