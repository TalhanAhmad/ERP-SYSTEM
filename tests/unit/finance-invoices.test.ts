import { it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  invoiceDraftSchema,
  invoiceLineSchema,
  invoiceQuerySchema,
  calculateInvoice,
} from "@/modules/finance/receivables/schemas";
import { accountSchema } from "@/modules/finance/accounting/schemas";
const line = {
  description: "Synthetic service",
  quantity: "1",
  unitRate: "100.005",
  discountAmount: "0.01",
  recognition: "EARNED",
  revenueAccountId: crypto.randomUUID(),
  deferredAccountId: null,
  projectId: null,
};
const invoice = {
  partyId: crypto.randomUUID(),
  receivableAccountId: crypto.randomUUID(),
  invoiceDate: "2026-11-01",
  postingDate: "2026-11-12",
  dueDate: "2026-11-30",
  description: "Synthetic invoice",
  evidence: "Fixture evidence",
  reason: "Reviewed synthetic billing",
  lines: [line],
};
it("calculates HALF_UP rounded lines, explicit discounts and totals without client authority", () => {
  const totals = calculateInvoice([
    line,
    { ...line, quantity: "3", unitRate: "0.335", discountAmount: "0.01" },
  ]);
  expect(totals).toMatchObject({
    lineAmount: "101.02",
    discountAmount: "0.02",
    netAmount: "101.00",
    taxAmount: "0.00",
    totalAmount: "101.00",
  });
  expect(totals.lines.map((l) => l.totalAmount)).toEqual(["100.00", "1.00"]);
  expect(
    calculateInvoice(
      Array(10).fill({ ...line, unitRate: "0.005", discountAmount: "0.00" }),
    ).totalAmount,
  ).toBe("0.10");
});
it.each([1, "-1", "1e3", "1\n", "1.1234567"])(
  "rejects unsafe quantity %s",
  (quantity) =>
    expect(invoiceLineSchema.safeParse({ ...line, quantity }).success).toBe(
      false,
    ),
);
it.each([0.1, "-1", "NaN", "1.1234567", "1\u2028"])(
  "rejects unsafe unit price %s",
  (unitRate) =>
    expect(invoiceLineSchema.safeParse({ ...line, unitRate }).success).toBe(
      false,
    ),
);
it.each([
  { totalAmount: "100.00" },
  { number: "INV-0000000001" },
  { partySnapshot: { name: "forged" } },
  { createdById: crypto.randomUUID() },
  { currency: "USD" },
  { taxAmount: "5.00" },
])("rejects client-authoritative header fields %j", (patch) =>
  expect(invoiceDraftSchema.safeParse({ ...invoice, ...patch }).success).toBe(
    false,
  ),
);
it("bounds discounts and summed totals while retaining valid free lines", () => {
  expect(
    invoiceDraftSchema.safeParse({
      ...invoice,
      lines: [{ ...line, discountAmount: "101.00" }],
    }).success,
  ).toBe(false);
  expect(
    invoiceDraftSchema.safeParse({
      ...invoice,
      lines: [
        { ...line, unitRate: "99999999999999", quantity: "99999999999999" },
      ],
    }).success,
  ).toBe(false);
  expect(
    calculateInvoice([
      { ...line, quantity: "1", unitRate: "100", discountAmount: "100.00" },
    ]).totalAmount,
  ).toBe("0.00");
});
it("requires explicit deferred mappings and denies tax/actor overrides on lines", () => {
  expect(
    invoiceLineSchema.safeParse({ ...line, recognition: "DEFERRED" }).success,
  ).toBe(false);
  expect(
    invoiceLineSchema.safeParse({
      ...line,
      recognition: "DEFERRED",
      deferredAccountId: crypto.randomUUID(),
    }).success,
  ).toBe(true);
  for (const patch of [
    { deferredAccountId: crypto.randomUUID() },
    { taxCodeId: crypto.randomUUID() },
    { credit: "100.00" },
  ])
    expect(invoiceLineSchema.safeParse({ ...line, ...patch }).success).toBe(
      false,
    );
});
it("validates chronological calendar dates and bounded invoice filters", () => {
  for (const patch of [
    { invoiceDate: "2026-02-30" },
    { dueDate: "2026-10-31" },
    { postingDate: "2026-10-31" },
    { lines: [] },
    { lines: Array(101).fill(line) },
  ])
    expect(invoiceDraftSchema.safeParse({ ...invoice, ...patch }).success).toBe(
      false,
    );
  for (const q of [
    { sort: "raw" },
    { state: "REVERSED" },
    { pageSize: 101 },
    { from: "2026-12-01", to: "2026-11-01" },
  ])
    expect(invoiceQuerySchema.safeParse(q).success).toBe(false);
});
it("allows deferred controls only as noncontra liability accounts", () => {
  const control = {
    code: "D11",
    name: "Synthetic deferred control",
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "DEFERRED_REVENUE",
    isPosting: true,
    isContra: false,
    isCashEquivalent: false,
    reason: "Explicit mapping",
  };
  expect(accountSchema.safeParse(control).success).toBe(true);
  expect(
    accountSchema.safeParse({
      ...control,
      type: "ASSET",
      normalSide: "DEBIT",
      reportGroup: "CURRENT_ASSETS",
    }).success,
  ).toBe(false);
});
it("leaves Prisma's global Decimal precision unchanged", () => {
  const precision = Prisma.Decimal.precision;
  calculateInvoice([line]);
  expect(Prisma.Decimal.precision).toBe(precision);
});
