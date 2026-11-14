import { it, expect } from "vitest";
import {
  holdingDraftSchema,
  holdingQuerySchema,
} from "@/modules/finance/investments/schemas";
import { movementDraftSchema } from "@/modules/finance/treasury/schemas";
const body = () => ({
  name: "Holding",
  partyId: crypto.randomUUID(),
  investmentType: "Reviewed fund",
  unitMode: "UNIT",
  classification: "CURRENT",
  policyStatus: "PENDING",
  measurementMode: "COST",
  valuationTreatment: "PROFIT_LOSS",
  policy: "Pending external policy review",
  evidence: "Policy reference",
  investmentAccountId: crypto.randomUUID(),
  reason: "Private company holding",
});
it("pending policy is explicit while reviewed policy requires complete posting maps", () => {
  expect(holdingDraftSchema.safeParse(body()).success).toBe(true);
  expect(
    holdingDraftSchema.safeParse({ ...body(), policyStatus: "REVIEWED" })
      .success,
  ).toBe(false);
  expect(
    holdingDraftSchema.safeParse({ ...body(), policyStatus: "COMPLIANT" })
      .success,
  ).toBe(false);
  expect(
    holdingDraftSchema.safeParse({ ...body(), currency: "USD" }).success,
  ).toBe(false);
});
it("acquisition quantities and cost use bounded decimal strings without issuer or control overrides", () => {
  const b = {
    kind: "INVESTMENT_ACQUISITION",
    holdingId: crypto.randomUUID(),
    fromCashId: crypto.randomUUID(),
    amount: "0.01",
    units: "99999999999999.999999",
    reference: "I1",
    documentDate: "2026-01-01",
    postingDate: "2026-01-01",
    description: "Acquisition",
    evidence: "Reviewed trade evidence",
    reason: "Company acquisition",
  };
  expect(movementDraftSchema.safeParse(b).success).toBe(true);
  for (const p of [
    { units: "0" },
    { units: "0.0000001" },
    { partyId: crypto.randomUUID() },
    { controlAccountId: crypto.randomUUID() },
    { loanId: crypto.randomUUID() },
    { currency: "USD" },
  ])
    expect(movementDraftSchema.safeParse({ ...b, ...p }).success).toBe(false);
});
it("holding register filters bound pages and validate as-of dates", () => {
  expect(holdingQuerySchema.parse({}).asOf).toBe("9999-12-31");
  for (const q of [
    { page: 0 },
    { policyStatus: "COMPLIANT" },
    { asOf: "2026-02-30" },
  ])
    expect(holdingQuerySchema.safeParse(q).success).toBe(false);
});
