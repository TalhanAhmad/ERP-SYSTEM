import { it, expect } from "vitest";
import {
  scheduleCreate,
  automationSchemas,
  automationOptions,
} from "@/modules/finance/automation/schemas";
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  base = {
    name: "Reviewed monthly rent",
    kind: "BILL",
    startMonth: "2020-01",
    endMonth: "2020-12",
    day: 1,
    evidence: "Reviewed supplier obligation and source",
    reason: "Prepare drafts only",
    template: {
      description: "Reviewed rent",
      partyId: id,
      payableAccountId: id,
      costAccountId: other,
      amount: "10.01",
      dueDays: 15,
    },
  };
it("requires explicit reviewed schedule terms and preserves exact PKR strings", () => {
  expect(scheduleCreate.parse(base).template).toMatchObject({
    amount: "10.01",
  });
  for (const patch of [
    { day: 0 },
    { day: 29 },
    { day: 1.5 },
    { startMonth: "0000-01" },
    { endMonth: "2019-12" },
    { startMonth: "2020-13" },
    { evidence: "" },
  ])
    expect(scheduleCreate.safeParse({ ...base, ...patch }).success).toBe(false);
});
it.each([
  "actorId",
  "grantId",
  "postedById",
  "journalId",
  "leaseId",
  "balance",
  "autoPost",
])("rejects forged recurring %s metadata", (key) => {
  expect(scheduleCreate.safeParse({ ...base, [key]: true }).success).toBe(
    false,
  );
  expect(
    scheduleCreate.safeParse({
      ...base,
      template: { ...base.template, [key]: true },
    }).success,
  ).toBe(false);
});
it("limits one-unit recurring bill rates without rounding or inventing supplier quantities", () => {
  expect(
    scheduleCreate.safeParse({
      ...base,
      template: { ...base.template, amount: "99999999999999.99" },
    }).success,
  ).toBe(true);
  for (const amount of [
    "100000000000000.00",
    "0.00",
    "-1",
    "1e2",
    "10.01\n",
    10.01,
  ])
    expect(
      scheduleCreate.safeParse({
        ...base,
        template: { ...base.template, amount },
      }).success,
    ).toBe(false);
});
it("uses explicit balanced journal sides and reviewed depreciation mappings", () => {
  const common = { ...base, template: undefined };
  expect(
    scheduleCreate.safeParse({
      ...common,
      kind: "JOURNAL",
      template: {
        description: "Reviewed prepaid amortization",
        debitAccountId: id,
        creditAccountId: other,
        amount: "999999999999999999.99",
      },
    }).success,
  ).toBe(true);
  expect(
    scheduleCreate.safeParse({
      ...common,
      kind: "JOURNAL",
      template: {
        description: "Invalid same account",
        debitAccountId: id,
        creditAccountId: id,
        amount: "1.00",
      },
    }).success,
  ).toBe(false);
  expect(
    scheduleCreate.safeParse({
      ...common,
      kind: "DEPRECIATION",
      template: {
        description: "Reviewed monthly asset charge",
        assetId: id,
        expenseAccountId: other,
        accumulatedAccountId: id,
      },
    }).success,
  ).toBe(true);
});
it("requires original deferred source, exact amount and evidence while denying invented journal lines", () => {
  const body = {
    invoiceLineId: id,
    postingDate: "2020-02-01",
    amount: "1.01",
    description: "Earn delivered service",
    evidence: "Client acceptance record",
    reason: "Review delivered portion",
  };
  expect(automationSchemas.RECOGNITION_CREATE.parse(body).amount).toBe("1.01");
  for (const patch of [
    { postingDate: "2020-02-30" },
    { amount: "0" },
    { invoiceLineId: "" },
    { evidence: "" },
    { lines: [] },
  ])
    expect(
      automationSchemas.RECOGNITION_CREATE.safeParse({ ...body, ...patch })
        .success,
    ).toBe(false);
});
it("validates exact source/version before classifying an imported credit", () => {
  const v = {
    side: "CUSTOMER",
    documentId: id,
    expectedVersion: 1,
    offsetAccountId: other,
    evidence: "Owner reviewed retained equity correction",
    reason: "Bind original draft",
  };
  expect(automationSchemas.OPENING_CREDIT_REVIEW.parse(v)).toEqual(v);
  for (const patch of [
    { side: "BOTH" },
    { expectedVersion: 0 },
    { documentId: "" },
    { evidence: "" },
    { basisHash: "forged" },
  ])
    expect(
      automationSchemas.OPENING_CREDIT_REVIEW.safeParse({ ...v, ...patch })
        .success,
    ).toBe(false);
});
it("requires a dated deferred-choice query and bounds pagination/search without hidden filters", () => {
  expect(automationOptions.safeParse({ kind: "DEFERRED" }).success).toBe(false);
  expect(
    automationOptions.safeParse({
      kind: "DEFERRED",
      asOf: "2020-01-01",
      q: "reviewed",
    }).success,
  ).toBe(true);
  for (const patch of [
    { page: 0 },
    { page: 10001 },
    { q: "a".repeat(101) },
    { ownerId: id },
  ])
    expect(
      automationOptions.safeParse({ kind: "ASSET", ...patch }).success,
    ).toBe(false);
});
