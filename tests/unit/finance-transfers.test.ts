import { it, expect } from "vitest";
import {
  movementDraftSchema,
  cashQuerySchema,
} from "@/modules/finance/treasury/schemas";
const body = () => ({
  kind: "TRANSFER",
  reference: "test",
  documentDate: "2026-01-01",
  postingDate: "2026-01-01",
  description: "Test transfer",
  evidence: "Reviewed evidence",
  amount: "0.01",
  fromCashId: crypto.randomUUID(),
  toCashId: crypto.randomUUID(),
  reason: "Synthetic review",
});
it("requires distinct cash accounts and string money", () => {
  const b = body();
  expect(movementDraftSchema.parse(b).amount).toBe("0.01");
  for (const patch of [
    { toCashId: b.fromCashId },
    { amount: 1 },
    { amount: "0" },
    { amount: "1.001" },
  ])
    expect(movementDraftSchema.safeParse({ ...b, ...patch }).success).toBe(
      false,
    );
});
it("rejects unsupported classifications, foreign currency and hidden manual legs", () => {
  for (const patch of [
    { currency: "USD" },
    { kind: "JOURNAL" },
    { controlAccountId: crypto.randomUUID() },
    { lines: [] },
  ])
    expect(movementDraftSchema.safeParse({ ...body(), ...patch }).success).toBe(
      false,
    );
});
it("validates cash date ranges and bounded pages without floats", () => {
  expect(cashQuerySchema.parse({ includeInternal: "NO" }).includeInternal).toBe(
    "NO",
  );
  for (const q of [
    { from: "2026-02-01", to: "2026-01-01" },
    { page: 0 },
    { includeInternal: "true" },
  ])
    expect(cashQuerySchema.safeParse(q).success).toBe(false);
});
