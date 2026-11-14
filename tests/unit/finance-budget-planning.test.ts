import { it, expect } from "vitest";
import {
  planningSchemas,
  budgetQuerySchema,
  varianceQuerySchema,
  forecastQuerySchema,
} from "@/modules/finance/planning/schemas";
const body = {
  month: "9999-12",
  projectId: null,
  description: "Reviewed monthly budget",
  evidence: "Approved planning reference",
  lines: [{ accountId: crypto.randomUUID(), amount: "100.01" }],
  reason: "Record expected incurred costs",
};
it("budget drafts require unique exact expense-account plans and an explicit matching revision pair", () => {
  expect(planningSchemas.BUDGET_CREATE.parse(body)).toMatchObject({
    previousId: null,
    previousVersion: null,
  });
  for (const patch of [
    { previousId: crypto.randomUUID() },
    { previousVersion: 2 },
    { state: "APPROVED" },
    { lines: [body.lines[0], body.lines[0]] },
    { month: "0000-01" },
    { lines: [{ ...body.lines[0], amount: 100.01 }] },
  ])
    expect(
      planningSchemas.BUDGET_CREATE.safeParse({ ...body, ...patch }).success,
    ).toBe(false);
  expect(
    planningSchemas.BUDGET_UPDATE.safeParse({ ...body, expectedVersion: 1 })
      .success,
  ).toBe(false);
});
it("future cash forecasts are strict independent plans with positive exact amounts and likelihood evidence", () => {
  const forecast = {
    kind: "PAYMENT",
    expectedDate: "9999-12-31",
    amount: "999999999999999999.99",
    projectId: null,
    partyId: null,
    likelihood: "POSSIBLE",
    likelihoodNote: "Vendor quote not confirmed",
    description: "Expected equipment payment",
    evidence: "Pending purchase planning reference",
    reason: "Forecast only without accounting",
  };
  expect(planningSchemas.FORECAST_CREATE.parse(forecast).expectedDate).toBe(
    "9999-12-31",
  );
  for (const patch of [
    { amount: "0.00" },
    { amount: "1.001" },
    { likelihoodNote: "" },
    { journalId: crypto.randomUUID() },
    { paid: true },
    { expectedDate: "2026-02-30" },
    { description: 123 },
  ])
    expect(
      planningSchemas.FORECAST_CREATE.safeParse({ ...forecast, ...patch })
        .success,
    ).toBe(false);
});
it("budget/variance/cash query filters preserve blank optional month and reject invalid or reversed date scopes", () => {
  expect(budgetQuerySchema.parse({ q: "review", month: "" }).q).toBe("review");
  expect(budgetQuerySchema.parse({ month: "" }).month).toBeUndefined();
  expect(
    varianceQuerySchema.safeParse({ month: "9999-12", projectId: "SHARED" })
      .success,
  ).toBe(true);
  expect(
    forecastQuerySchema.safeParse({ from: "2026-02-02", to: "2026-02-01" })
      .success,
  ).toBe(false);
  expect(budgetQuerySchema.safeParse({ page: 10001 }).success).toBe(false);
});
