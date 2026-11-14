import { it, expect } from "vitest";
import {
  statementReserveSchema,
  statementBalanceSchema,
  statementImportSchema,
} from "@/modules/finance/treasury/statements/schemas";
it("statement reservations cap exact byte counts and reject paths, credentials and trusted server values", () => {
  const b = {
    cashAccountId: crypto.randomUUID(),
    fileName: "bank.csv",
    byteSize: 5_000_000,
    sha256: "a".repeat(64),
    reason: "Review source statement",
  };
  expect(statementReserveSchema.parse(b).byteSize).toBe(5_000_000);
  for (const patch of [
    { byteSize: 5_000_001 },
    { fileName: "../bank.csv" },
    { fileName: "bank.exe" },
    { intentHash: "a".repeat(64) },
    { password: "not-a-bank-login" },
    { byteSize: 0 },
  ])
    expect(statementReserveSchema.safeParse({ ...b, ...patch }).success).toBe(
      false,
    );
});
it("signed statement balances remain exact and import payloads cannot provide their own normalized rows", () => {
  expect(statementBalanceSchema.parse("-999999999999999999.99")).toBe(
    "-999999999999999999.99",
  );
  expect(statementBalanceSchema.parse("-0.00")).toBe("0.00");
  const body = {
    mapping: {
      mode: "SIGNED",
      dateColumn: 0,
      dateFormat: "ISO",
      amountColumn: 1,
      positiveMeans: "RECEIPT",
    },
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    openingBalance: "0.00",
    closingBalance: "10.01",
    expectedVersion: 2,
    basisHash: "a".repeat(64),
    reason: "Import reviewed evidence",
  };
  expect(statementImportSchema.safeParse(body).success).toBe(true);
  expect(
    statementImportSchema.safeParse({ ...body, rows: [{ amount: "999.00" }] })
      .success,
  ).toBe(false);
  expect(
    statementImportSchema.safeParse({
      ...body,
      acknowledgedRows: [2],
      duplicateReview: "",
    }).success,
  ).toBe(false);
  expect(
    statementImportSchema.safeParse({ ...body, endDate: "2025-01-01" }).success,
  ).toBe(false);
});
