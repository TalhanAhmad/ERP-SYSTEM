import { it, expect } from "vitest";
import { movementDraftSchema } from "@/modules/finance/treasury/schemas";
const body = () => ({
  kind: "CAPITAL_CONTRIBUTION",
  reference: "CAP-1",
  documentDate: "2026-01-01",
  postingDate: "2026-01-01",
  description: "Capital",
  evidence: "Reviewed evidence",
  amount: "1.01",
  toCashId: crypto.randomUUID(),
  partyId: crypto.randomUUID(),
  controlAccountId: crypto.randomUUID(),
  reason: "Reviewed funding",
});
it("cash capital requires contributor, control and receiving bank without a manual debit", () => {
  expect(movementDraftSchema.safeParse(body()).success).toBe(true);
  for (const p of [
    { partyId: null },
    { toCashId: null },
    { counterAccountId: crypto.randomUUID() },
    { fromCashId: crypto.randomUUID() },
  ])
    expect(movementDraftSchema.safeParse({ ...body(), ...p }).success).toBe(
      false,
    );
});
it("returns and distributions require explicit approval and an outgoing bank", () => {
  const b = body(),
    d = { ...b, kind: "DISTRIBUTION", toCashId: null, fromCashId: b.toCashId };
  expect(movementDraftSchema.safeParse(d).success).toBe(false);
  expect(
    movementDraftSchema.safeParse({
      ...d,
      approvalEvidence: "Approved board reference",
    }).success,
  ).toBe(true);
});
it("personal bill settlement requires an existing bill, control and AP debit with no cash", () => {
  const d = {
    ...body(),
    kind: "FOUNDER_BILL_SETTLEMENT",
    toCashId: null,
    counterAccountId: crypto.randomUUID(),
    billId: crypto.randomUUID(),
  };
  expect(movementDraftSchema.safeParse(d).success).toBe(true);
  expect(movementDraftSchema.safeParse({ ...d, billId: null }).success).toBe(
    false,
  );
});
