import { it, expect } from "vitest";
import {
  profitLossQuerySchema,
  balanceSheetQuerySchema,
  statementSettingSchemas,
} from "@/modules/finance/reports/statements/schemas";
it("financial statement filters enforce real inclusive dates and bounded independent row/issue pages", () => {
  expect(
    profitLossQuerySchema.safeParse({ from: "0001-01-01", to: "9999-12-31" })
      .success,
  ).toBe(true);
  expect(
    balanceSheetQuerySchema.safeParse({ asOf: "9999-12-31", issuePage: "2" })
      .success,
  ).toBe(true);
  for (const v of [
    { from: "2026-02-30", to: "2026-11-01" },
    { from: "2026-11-02", to: "2026-11-01" },
    { from: "0001-01-01", to: "9999-12-31", issuePage: 0 },
    { from: "0001-01-01", to: "9999-12-31", finalExportEligible: true },
  ])
    expect(profitLossQuerySchema.safeParse(v).success).toBe(false);
});
it("presentation choice requires explicit reviewed fields/version and never accepts a caller owner or ledger amount", () => {
  const b = {
    overdraftPresentation: "CURRENT_LIABILITY",
    evidence: "Explicit presentation review",
    expectedVersion: null,
    reason: "Company review recorded",
  };
  expect(statementSettingSchemas.POLICY_SET.safeParse(b).success).toBe(true);
  for (const extra of [
    { overdraftPresentation: "AUTOMATIC" },
    { ownerId: crypto.randomUUID() },
    { cashBalance: "1000.00" },
    { expectedVersion: 0 },
  ])
    expect(
      statementSettingSchemas.POLICY_SET.safeParse({ ...b, ...extra }).success,
    ).toBe(false);
});
it("income-tax classification is an exact account/boolean/version contract rather than an inferred tax rate", () => {
  const b = {
    accountId: crypto.randomUUID(),
    active: true,
    evidence: "Recorded ordinary income-tax expense presentation",
    reason: "Review actual expense classification",
    expectedVersion: null,
  };
  expect(statementSettingSchemas.TAX_MAPPING_SET.safeParse(b).success).toBe(
    true,
  );
  for (const extra of [
    { active: "true" },
    { taxRate: "30" },
    { accountId: "unknown" },
    { expectedVersion: 1.5 },
  ])
    expect(
      statementSettingSchemas.TAX_MAPPING_SET.safeParse({ ...b, ...extra })
        .success,
    ).toBe(false);
});
