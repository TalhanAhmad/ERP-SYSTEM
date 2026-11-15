import { it, expect } from "vitest";
import {
  generalLedgerQuerySchema,
  trialBalanceQuerySchema,
  reportAccountQuerySchema,
} from "@/modules/finance/reports/schemas";
const range = { from: "0001-01-01", to: "9999-12-31" };
it("general ledger requires a real posting account and bounded calendar dates, rejecting claimed totals/proofs", () => {
  const b = { ...range, accountId: crypto.randomUUID() };
  expect(generalLedgerQuerySchema.safeParse(b).success).toBe(true);
  for (const v of [
    { ...b, from: "2026-02-30" },
    { ...b, to: "0000-01-01" },
    { ...b, from: "2026-11-15", to: "2026-11-14" },
    { ...b, accountId: "" },
    { ...b, closingBalance: "0.00" },
    { ...b, sourceProof: { accepted: true } },
  ])
    expect(generalLedgerQuerySchema.safeParse(v).success).toBe(false);
});
it("trial balance display flags are explicit, with bounded search and no account filter pretending to be company totals", () => {
  expect(trialBalanceQuerySchema.parse(range).includeZero).toBe("NO");
  for (const extra of [
    { includeZero: "false" },
    { includeZero: true },
    { accountId: crypto.randomUUID() },
    { q: "x".repeat(101) },
    { page: 0 },
    { page: 10001 },
  ])
    expect(
      trialBalanceQuerySchema.safeParse({ ...range, ...extra }).success,
    ).toBe(false);
  expect(
    trialBalanceQuerySchema.safeParse({
      ...range,
      includeZero: "YES",
      page: "2",
    }).success,
  ).toBe(true);
});
it("read choices expose a bounded search/page contract without a caller role or control filter", () => {
  expect(reportAccountQuerySchema.parse({})).toEqual({ q: "", page: 1 });
  expect(
    reportAccountQuerySchema.safeParse({ role: "SUPER_ADMIN" }).success,
  ).toBe(false);
  expect(
    reportAccountQuerySchema.safeParse({ controlType: "NONE" }).success,
  ).toBe(false);
  expect(
    reportAccountQuerySchema.safeParse({ page: 10000, q: "archived" }).success,
  ).toBe(true);
});
