import { it, expect } from "vitest";
import {
  bankMatchSchemas,
  bankMatchPreviewSchema,
  bankMatchOptionsSchema,
} from "@/modules/finance/treasury/matching/schemas";
const edge = {
    statementLineId: crypto.randomUUID(),
    journalLineId: crypto.randomUUID(),
    amount: "10.01",
  },
  body = { cashAccountId: crypto.randomUUID(), allocations: [edge] };
it("matching accepts exact positive full-range PKR but rejects zero, negative, float, excess scale and claimed positions", () => {
  expect(bankMatchPreviewSchema.parse(body)).toEqual(body);
  for (const amount of [
    "0.00",
    "-1.00",
    "1.001",
    "1e2",
    "1000000000000000000.00",
    1,
  ])
    expect(
      bankMatchPreviewSchema.safeParse({
        ...body,
        allocations: [{ ...edge, amount }],
      }).success,
    ).toBe(false);
  expect(
    bankMatchPreviewSchema.safeParse({
      ...body,
      allocations: [{ ...edge, remaining: "1000.00" }],
    }).success,
  ).toBe(false);
});
it("matching limits distinct allocation edges and generates identity/date from retained sources", () => {
  expect(
    bankMatchPreviewSchema.safeParse({ ...body, allocations: [edge, edge] })
      .success,
  ).toBe(false);
  expect(
    bankMatchPreviewSchema.safeParse({
      ...body,
      allocations: Array.from({ length: 101 }, () => ({
        ...edge,
        journalLineId: crypto.randomUUID(),
      })),
    }).success,
  ).toBe(false);
  expect(
    bankMatchPreviewSchema.safeParse({ ...body, effectiveDate: "2026-11-01" })
      .success,
  ).toBe(false);
  expect(
    bankMatchSchemas.MATCH.safeParse({
      ...body,
      description: "Explicit bank review",
      evidence: "Reviewed retained source",
      reason: "Reviewed source",
      basisHash: "f".repeat(64),
      id: crypto.randomUUID(),
    }).success,
  ).toBe(false);
});
it("match options validate real calendar dates and explicit side/account, unmatch requires a version/reason", () => {
  expect(
    bankMatchOptionsSchema.parse({
      kind: "CASH",
      cashAccountId: body.cashAccountId,
    }).to,
  ).toBe("9999-12-31");
  for (const x of [
    { kind: "AUTO", cashAccountId: body.cashAccountId },
    { kind: "CASH", cashAccountId: body.cashAccountId, from: "2026-02-30" },
    {
      kind: "CASH",
      cashAccountId: body.cashAccountId,
      from: "2026-11-02",
      to: "2026-11-01",
    },
  ])
    expect(bankMatchOptionsSchema.safeParse(x).success).toBe(false);
  expect(
    bankMatchSchemas.UNMATCH.safeParse({
      expectedVersion: 2,
      reason: "Correction reviewed",
    }).success,
  ).toBe(true);
  expect(
    bankMatchSchemas.UNMATCH.safeParse({ reason: "Correction reviewed" })
      .success,
  ).toBe(false);
});
