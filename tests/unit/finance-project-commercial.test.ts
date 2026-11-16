import { it, expect } from "vitest";
import {
  projectSchemas as s,
  commercialOptionSchema,
  commercialChildQuerySchema,
} from "@/modules/finance/projects/schemas";
const profile = {
  projectId: crypto.randomUUID(),
  clientId: crypto.randomUUID(),
  originalContract: "100.01",
  billingModel: "MILESTONE",
  terms: "Commercial terms",
  evidence: "Signed reference",
  reason: "Review agreement",
};
it("commercial records use exact bounded PKR strings and reject source identity, posted amount or currency overrides", () => {
  expect(s.PROFILE_CREATE.parse(profile).originalContract).toBe("100.01");
  for (const patch of [
    { originalContract: 100.01 },
    { originalContract: "1.001" },
    { originalContract: "-1.00" },
    { originalContract: "1000000000000000000.00" },
    { contractValue: "1.00" },
    { currency: "USD" },
    { projectId: "not-an-id" },
    { journalId: crypto.randomUUID() },
  ])
    expect(s.PROFILE_CREATE.safeParse({ ...profile, ...patch }).success).toBe(
      false,
    );
  const { projectId, ...edit } = profile;
  void projectId;
  expect(
    s.PROFILE_UPDATE.safeParse({ ...edit, expectedVersion: 1 }).success,
  ).toBe(true);
  expect(
    s.PROFILE_UPDATE.safeParse({ ...profile, expectedVersion: 1 }).success,
  ).toBe(false);
});
it("billing plan dates, signed evidence and amendment amount/direction are explicit", () => {
  const m = {
    projectId: profile.projectId,
    description: "Billing stage",
    amount: "50.01",
    expectedDate: "2026-01-01",
    dueDate: "2026-01-31",
    evidence: "Approved plan",
    reason: "Draft billing plan",
  };
  expect(s.MILESTONE_CREATE.safeParse(m).success).toBe(true);
  for (const patch of [
    { dueDate: "2025-12-31" },
    { expectedDate: "2026-02-30" },
    { amount: "0.00" },
    { amount: 1 },
    { approvalEvidence: "Pretend already confirmed" },
  ])
    expect(s.MILESTONE_CREATE.safeParse({ ...m, ...patch }).success).toBe(
      false,
    );
  expect(
    s.PROFILE_ACTIVATE.safeParse({
      expectedVersion: 1,
      signedDate: "2026-01-01",
      reason: "Confirm agreement",
    }).success,
  ).toBe(false);
  expect(
    s.VARIATION_CREATE.safeParse({
      projectId: profile.projectId,
      direction: "INCREASE",
      amount: "1.00",
      reference: "S1",
      description: "Signed amendment",
      signedDate: "2026-01-01",
      evidence: "Signed source",
      reason: "Review variation",
    }).success,
  ).toBe(true);
});
it("invoice links cannot provide a trusted value or journal and source selectors require a project", () => {
  const link = {
    milestoneId: crypto.randomUUID(),
    invoiceLineId: crypto.randomUUID(),
    reason: "Link posted source",
  };
  expect(s.LINK_CREATE.safeParse(link).success).toBe(true);
  for (const patch of [
    { originalNet: "10.00" },
    { snapshot: {} },
    { journalId: crypto.randomUUID() },
    { invoiceLineId: "not-an-id" },
  ])
    expect(s.LINK_CREATE.safeParse({ ...link, ...patch }).success).toBe(false);
  expect(
    commercialOptionSchema.safeParse({ kind: "INVOICE_LINE" }).success,
  ).toBe(false);
  for (const q of [
    { page: 0 },
    { page: 10001 },
    { state: "PUBLIC" },
    { q: "x".repeat(101) },
    { unknown: true },
  ])
    expect(commercialChildQuerySchema.safeParse(q).success).toBe(false);
});
