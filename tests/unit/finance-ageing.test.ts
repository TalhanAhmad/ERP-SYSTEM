import { it, expect } from "vitest";
import {
  ageingQuerySchema,
  ageingHistoryQuerySchema,
} from "@/modules/finance/reports/ageing/schemas";
it("historical ageing accepts real cutoff extremes and independently bounded display and control pages", () => {
  expect(
    ageingQuerySchema.parse({ asOf: "0001-01-01", page: "2", issuePage: "3" }),
  ).toMatchObject({
    page: 2,
    issuePage: 3,
    includeSettled: "NO",
    bucket: "ALL",
  });
  expect(ageingQuerySchema.safeParse({ asOf: "9999-12-31" }).success).toBe(
    true,
  );
  for (const x of [
    { asOf: "2026-02-30" },
    { asOf: "0000-01-01" },
    { asOf: "2026-11-15", issuePage: 10001 },
    { asOf: "2026-11-15", page: 0 },
  ])
    expect(ageingQuerySchema.safeParse(x).success).toBe(false);
});
it("ageing filters use explicit buckets and never accept current payment state or caller control readiness", () => {
  const b = { asOf: "2026-11-15", bucket: "DAYS_31_60", includeSettled: "YES" };
  expect(ageingQuerySchema.safeParse(b).success).toBe(true);
  for (const x of [
    { bucket: "OVERDUE" },
    { includeSettled: true },
    { currentState: "SETTLED" },
    { controlTotal: "0.00" },
    { reconciliationReady: true },
  ])
    expect(ageingQuerySchema.safeParse({ ...b, ...x }).success).toBe(false);
});
it("dated-event history requires an actual document ID, real date and bounded page without a caller running balance", () => {
  const b = { documentId: crypto.randomUUID(), asOf: "2026-11-15", page: 2 };
  expect(ageingHistoryQuerySchema.safeParse(b).success).toBe(true);
  for (const x of [
    { documentId: "guessed" },
    { page: -1 },
    { runningBalance: "100.00" },
    { side: "AR" },
  ])
    expect(ageingHistoryQuerySchema.safeParse({ ...b, ...x }).success).toBe(
      false,
    );
});
