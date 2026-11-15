import { it, expect } from "vitest";
import { reconciliationSchemas } from "@/modules/finance/treasury/reconciliation/schemas";
const base = {
  cashAccountId: crypto.randomUUID(),
  evidence: "Reviewed actual bank statement",
  reason: "Explicit bank reconciliation review",
};
it("statement review derives dates/balances from its retained file and rejects client-invented proof", () => {
  const b = {
    ...base,
    mode: "STATEMENT",
    statementBatchId: crypto.randomUUID(),
  };
  expect(reconciliationSchemas.CREATE.safeParse(b).success).toBe(true);
  for (const extra of [
    { closingBalance: "100.00" },
    { sourceProof: { explainedDifference: "0.00" } },
    { finalSnapshot: { accepted: true } },
    { id: crypto.randomUUID() },
  ])
    expect(
      reconciliationSchemas.CREATE.safeParse({ ...b, ...extra }).success,
    ).toBe(false);
});
it("zero activity uses real bounded dates/exact signed balances and reviewed replacements need identity plus version", () => {
  const b = {
    ...base,
    mode: "ZERO_ACTIVITY",
    startDate: "2026-11-01",
    cutoffDate: "2026-11-14",
    openingBalance: "-10.01",
    closingBalance: "-10.01",
  };
  expect(reconciliationSchemas.CREATE.safeParse(b).success).toBe(true);
  for (const extra of [
    { cutoffDate: "2026-02-30" },
    { startDate: "2026-11-15" },
    { openingBalance: 10.01 },
    { closingBalance: "1.001" },
    { replacesId: crypto.randomUUID() },
  ])
    expect(
      reconciliationSchemas.CREATE.safeParse({ ...b, ...extra }).success,
    ).toBe(false);
});
it("notes are bounded distinct explicit items, and duplicate exclusion requires an actual peer", () => {
  const note = {
      rowKey: "STATEMENT:" + crypto.randomUUID(),
      kind: "EXCLUDE_DUPLICATE",
      note: "Exact fully matched original record reviewed",
      peerStatementLineId: crypto.randomUUID(),
    },
    b = {
      expectedVersion: 1,
      notes: [note],
      reason: "Review exact duplicate source",
    };
  expect(reconciliationSchemas.NOTES.safeParse(b).success).toBe(true);
  for (const notes of [
    [{ ...note, peerStatementLineId: null }],
    [note, note],
    Array.from({ length: 101 }, () => ({
      ...note,
      rowKey: "STATEMENT:" + crypto.randomUUID(),
    })),
  ])
    expect(reconciliationSchemas.NOTES.safeParse({ ...b, notes }).success).toBe(
      false,
    );
  expect(
    reconciliationSchemas.REOPEN.safeParse({
      expectedVersion: 2,
      reason: "Owner reviewed correction",
    }).success,
  ).toBe(true);
});
