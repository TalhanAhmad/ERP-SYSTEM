import { it, expect } from "vitest";
import {
  journalDraftSchema,
  journalLineSchema,
  journalQuerySchema,
  journalTotals,
  ledgerSchemas,
} from "@/modules/finance/ledger/schemas";
const line = {
  accountId: crypto.randomUUID(),
  description: "Synthetic line",
  debit: "1.20",
  credit: "0",
};
it.each([
  ["0", "0"],
  ["1", "1"],
  ["-1", "0"],
  ["1.001", "0"],
  [1, "0"],
  ["1\n", "0"],
])("rejects unsafe or two-sided journal lines %s %s", (debit, credit) =>
  expect(journalLineSchema.safeParse({ ...line, debit, credit }).success).toBe(
    false,
  ),
);
it("normalizes sides and recomputes totals from exact strings", () => {
  const parsed = journalLineSchema.parse(line);
  expect(parsed.debit).toBe("1.20");
  expect(
    journalTotals([parsed, { ...parsed, debit: "0.00", credit: "1.20" }]),
  ).toEqual({ debit: "1.20", credit: "1.20", balanced: true });
  expect(journalTotals([parsed]).balanced).toBe(false);
});
it("requires descriptive source/evidence, strict fields and bounded lines", () => {
  const body = {
    reference: "TEST",
    description: "Accrual",
    evidence: "Receipt reference",
    postingDate: "2026-11-12",
    lines: [line],
    reason: "Synthetic adjustment",
  };
  expect(journalDraftSchema.safeParse(body).success).toBe(true);
  for (const patch of [
    { evidence: "" },
    { currency: "USD" },
    { total: "1.20" },
    { lines: [] },
    { lines: Array(201).fill(line) },
  ])
    expect(journalDraftSchema.safeParse({ ...body, ...patch }).success).toBe(
      false,
    );
});
it("allows only bounded stable register filters and unique versioned batches", () => {
  for (const query of [
    { sort: "raw" },
    { pageSize: 101 },
    { from: "2026-11-12", to: "2026-01-01" },
  ])
    expect(journalQuerySchema.safeParse(query).success).toBe(false);
  const row = { id: crypto.randomUUID(), expectedVersion: 1 };
  expect(
    ledgerSchemas.BULK_VOID.safeParse({
      items: [row, row],
      reason: "Duplicate selection",
    }).success,
  ).toBe(false);
});
it("bounds each saved draft total before it can make the register unreadable", () => {
  const l = { ...line, debit: "999999999999999999.99", credit: "0.00" };
  expect(
    journalDraftSchema.safeParse({
      reference: "RANGE",
      description: "Bounded draft",
      evidence: "Synthetic only",
      postingDate: "2026-11-12",
      reason: "Range check",
      lines: [l, l],
    }).success,
  ).toBe(false);
});
