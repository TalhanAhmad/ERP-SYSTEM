import { it, expect } from "vitest";
import { splitCostPercentages } from "@/modules/finance/projects/costs/percentages";
import {
  costSchemas,
  costPreviewSchema,
  projectResultQuerySchema,
} from "@/modules/finance/projects/costs/schemas";
it("tiny cost shares use deterministic largest remainders without a negative final split", () => {
  expect(splitCostPercentages("0.03", ["20", "20", "20", "20", "20"])).toEqual([
    "0.01",
    "0.01",
    "0.01",
    "0.00",
    "0.00",
  ]);
  expect(splitCostPercentages("0.01", ["50", "50"])).toEqual(["0.01", "0.00"]);
});
it("fractional percentages preserve all paisa at maximum PKR precision", () => {
  expect(
    splitCostPercentages("100.00", ["33.333333", "33.333333", "33.333334"]),
  ).toEqual(["33.33", "33.33", "33.34"]);
  const a = splitCostPercentages("999999999999999999.99", ["50", "50"]);
  expect(a).toEqual(["500000000000000000.00", "499999999999999999.99"]);
});
it("percentage inputs reject totals other than100, excessive precision and unsupported money", () => {
  for (const p of [
    ["99"],
    ["101"],
    ["50", "49.999999"],
    ["-1", "101"],
    ["100.0000001"],
    [],
  ])
    expect(() => splitCostPercentages("1.00", p)).toThrow();
  expect(() => splitCostPercentages(1, ["100"])).toThrow();
});
it("cost drafts require exact unique dimensions and reject trusted account, balance and source overrides", () => {
  const a = crypto.randomUUID(),
    b = {
      sourceLineId: crypto.randomUUID(),
      postingDate: "2026-01-01",
      description: "Reclassify cost",
      evidence: "Reviewed split",
      basisHash: "a".repeat(64),
      targets: [{ projectId: a, amount: "1.00" }],
      reason: "Review cost assignment",
    };
  expect(costSchemas.CREATE.safeParse(b).success).toBe(true);
  for (const p of [
    { amount: "1.00" },
    { accountId: crypto.randomUUID() },
    { targets: [{ projectId: a, amount: 1 }] },
    {
      targets: [
        { projectId: a, amount: "0.50" },
        { projectId: a, amount: "0.50" },
      ],
    },
    { postingDate: "2026-02-30" },
    { basisHash: "bad" },
  ])
    expect(costSchemas.CREATE.safeParse({ ...b, ...p }).success).toBe(false);
  expect(
    costPreviewSchema.safeParse({
      sourceLineId: b.sourceLineId,
      basisHash: b.basisHash,
      targets: [
        { projectId: null, percentage: "50" },
        { projectId: null, percentage: "50" },
      ],
    }).success,
  ).toBe(false);
  expect(
    projectResultQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-01" })
      .success,
  ).toBe(false);
});
