import { it, expect } from "vitest";
import { loanDraftSchema } from "@/modules/finance/funding/loans/schemas";
import { movementDraftSchema } from "@/modules/finance/treasury/schemas";
const body = () => ({
  name: "Synthetic loan",
  partyId: crypto.randomUUID(),
  direction: "ADVANCED",
  startDate: "2026-01-01",
  maturityDate: "2026-12-31",
  agreedPrincipal: "100.01",
  annualRate: "12.123456",
  agreement: "Reviewed manual interest",
  principalAccountId: crypto.randomUUID(),
  interestAccountId: crypto.randomUUID(),
  interestResultAccountId: crypto.randomUUID(),
  reason: "Reviewed agreement",
});
it("loan terms support only two explicit directions with exact reference rates and principal", () => {
  expect(loanDraftSchema.parse(body()).agreedPrincipal).toBe("100.01");
  for (const p of [
    { direction: "BOTH" },
    { agreedPrincipal: 1 },
    { annualRate: "1000.000001" },
    { currency: "USD" },
    { maturityDate: "2025-12-31" },
  ])
    expect(loanDraftSchema.safeParse({ ...body(), ...p }).success).toBe(false);
});
it("manual plans must fit agreement dates and principal while creating no inferred schedule", () => {
  expect(loanDraftSchema.parse(body()).manualSchedule).toEqual([]);
  for (const manualSchedule of [
    [{ dueDate: "2027-01-01", principal: "1.00", interest: "0" }],
    [{ dueDate: "2026-02-01", principal: "100.02", interest: "0" }],
    [{ dueDate: "2026-02-01", principal: "1", interest: 2 }],
  ])
    expect(
      loanDraftSchema.safeParse({ ...body(), manualSchedule }).success,
    ).toBe(false);
});
it("loan movement fields cannot supply contributor/control overrides or mix accrued interest with cash", () => {
  const b = {
    kind: "LOAN_DISBURSEMENT",
    loanId: crypto.randomUUID(),
    toCashId: crypto.randomUUID(),
    reference: "L1",
    documentDate: "2026-01-01",
    postingDate: "2026-01-01",
    description: "Loan",
    evidence: "Agreement evidence",
    amount: "0.01",
    reason: "Reviewed principal",
  };
  expect(movementDraftSchema.safeParse(b).success).toBe(true);
  for (const p of [
    { partyId: crypto.randomUUID() },
    { controlAccountId: crypto.randomUUID() },
    { kind: "LOAN_INTEREST_ACCRUAL" },
    { fromCashId: crypto.randomUUID() },
  ])
    expect(movementDraftSchema.safeParse({ ...b, ...p }).success).toBe(false);
});
