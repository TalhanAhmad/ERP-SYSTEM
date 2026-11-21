import { it, expect } from "vitest";
import {
  openingSourceSchema,
  openingSchemas,
  openingQuery,
} from "@/modules/finance/opening/schemas";
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const source = {
  formatVersion: 1,
  name: "Reviewed cutover",
  currency: "PKR",
  cutoverDate: "2020-01-01",
  clearingAccountId: id,
  evidence: "Reviewed original dated trial balance",
  trialBalance: [
    { accountId: id, debit: "100.01", credit: "0.00" },
    { accountId: other, debit: "0.00", credit: "100.01" },
  ],
  items: [],
};
it("requires explicit dated PKR cutover, source evidence and decimal strings", () => {
  expect(openingSourceSchema.parse(source)).toEqual(source);
  for (const patch of [
    { currency: "USD" },
    { formatVersion: 2 },
    { cutoverDate: "2020-02-30" },
    { evidence: "" },
    { clearingAccountId: "" },
    { trialBalance: [{ accountId: id, debit: 0.1, credit: 0 }] },
  ])
    expect(openingSourceSchema.safeParse({ ...source, ...patch }).success).toBe(
      false,
    );
});
it.each([
  "ownerId",
  "actorId",
  "ready",
  "sourceHash",
  "journalId",
  "exchangeRate",
])("rejects client-forged %s source fields", (key) => {
  expect(
    openingSourceSchema.safeParse({ ...source, [key]: "spoofed" }).success,
  ).toBe(false);
});
it("requires full original AR/AP due dates and counterparties", () => {
  const item = {
    kind: "AR",
    accountId: id,
    amount: "10.01",
    reference: "Legacy open item",
    originalDate: "2019-01-01",
    dueDate: "2019-12-01",
    partyId: other,
    description: "Reviewed original unpaid amount",
  };
  expect(
    openingSourceSchema.safeParse({ ...source, items: [item] }).success,
  ).toBe(true);
  for (const patch of [
    { dueDate: null },
    { partyId: null },
    { amount: "0.00" },
    { amount: "-1" },
    { amount: "10.01\n" },
    { amount: 10.01 },
  ])
    expect(
      openingSourceSchema.safeParse({
        ...source,
        items: [{ ...item, ...patch }],
      }).success,
    ).toBe(false);
});
it("requires a file contract rather than caller-generated balance and hash fields", () => {
  const body = {
    fileName: "opening.json",
    sourceText: JSON.stringify(source),
    reason: "Stage original source",
  };
  expect(openingSchemas.CREATE.safeParse(body).success).toBe(true);
  for (const patch of [
    { fileName: "opening.csv" },
    { sourceText: "{" },
    { sourceHash: "forged" },
    { sourceText: "x".repeat(180001) },
  ])
    expect(openingSchemas.CREATE.safeParse({ ...body, ...patch }).success).toBe(
      false,
    );
});
it("requires source basis, exact version and evidenced approval before posting", () => {
  const body = {
    expectedVersion: 1,
    basisHash: "a".repeat(64),
    reviewEvidence: "Reviewed original file and all control matches",
    reason: "Post approved opening",
  };
  expect(openingSchemas.POST.parse(body)).toEqual(body);
  for (const patch of [
    { expectedVersion: 0 },
    { basisHash: "x" },
    { reviewEvidence: " " },
    { clearingBalance: "0.00" },
  ])
    expect(openingSchemas.POST.safeParse({ ...body, ...patch }).success).toBe(
      false,
    );
  expect(openingQuery.safeParse({ page: 10001 }).success).toBe(false);
});
