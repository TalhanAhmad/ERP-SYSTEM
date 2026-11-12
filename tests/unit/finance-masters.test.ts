import { it, expect } from "vitest";
import {
  partySchema,
  cashSchema,
  masterQuerySchema,
} from "@/modules/finance/masters/schemas";
import { formatPkr } from "@/modules/finance/components/money-cell";
const cash = {
  name: "Synthetic bank",
  kind: "BANK",
  glAccountId: crypto.randomUUID(),
  reason: "Synthetic fixture",
};
it.each(["12345678", "123", "1234\n", " 1234", "ABCD"])(
  "rejects references beyond four literal digits: %s",
  (maskedReference) =>
    expect(cashSchema.safeParse({ ...cash, maskedReference }).success).toBe(
      false,
    ),
);
it("allows only PKR typed cash mappings with no client balances", () => {
  expect(cashSchema.parse({ ...cash, maskedReference: "1234" }).currency).toBe(
    "PKR",
  );
  for (const patch of [
    { currency: "USD" },
    { balance: "1.00" },
    { bankNumber: "12345678" },
  ])
    expect(cashSchema.safeParse({ ...cash, ...patch }).success).toBe(false);
});
it("validates contact profiles without inventing a mandatory employee linkage", () => {
  const party = {
    name: "Demo",
    legalName: "Synthetic legal name",
    kind: "CLIENT",
    reason: "Reviewed demo only",
  };
  expect(partySchema.parse(party).userId).toBeNull();
  for (const patch of [
    { kind: "BANK" },
    { contactEmail: "bad" },
    { phone: "<script>" },
    { legalName: "" },
    { role: "SUPER_ADMIN" },
  ])
    expect(partySchema.safeParse({ ...party, ...patch }).success).toBe(false);
});
it("bounds queries and formats money without Number coercion", () => {
  expect(masterQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  expect(masterQuerySchema.safeParse({ sort: "raw" }).success).toBe(false);
  expect(formatPkr("999999999999999999.99")).toBe(
    "PKR 999,999,999,999,999,999.99",
  );
});
