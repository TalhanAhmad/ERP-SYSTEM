import { it, expect } from "vitest";
import {
  rollforwardKindSchema,
  rollforwardQuerySchema,
  rollforwardHistorySchema,
  postedSourceQuerySchema,
} from "@/modules/finance/reports/rollforwards/schemas";
it("roll-forward date filters accept inclusive extremes and reject malformed ranges and independent page overflow", () => {
  expect(
    rollforwardQuerySchema.parse({
      from: "0001-01-01",
      to: "9999-12-31",
      page: "2",
      issuePage: "3",
    }),
  ).toMatchObject({ page: 2, issuePage: 3 });
  for (const extra of [
    { from: "2026-02-30" },
    { from: "9999-12-31", to: "0001-01-01" },
    { page: 0 },
    { issuePage: 10001 },
    { controlReady: true },
  ])
    expect(
      rollforwardQuerySchema.safeParse({
        from: "2026-01-01",
        to: "2026-11-16",
        ...extra,
      }).success,
    ).toBe(false);
});
it("historical source selection requires a real dimension key and cannot accept caller balances or actors", () => {
  const body = { from: "2026-01-01", to: "2026-11-16", rowKey: "a".repeat(64) };
  expect(rollforwardHistorySchema.safeParse(body).success).toBe(true);
  for (const extra of [
    { rowKey: "guessed" },
    { actorId: crypto.randomUUID() },
    { closingBalance: "100.00" },
    { page: 10001 },
  ])
    expect(
      rollforwardHistorySchema.safeParse({ ...body, ...extra }).success,
    ).toBe(false);
  for (const kind of [
    "PROJECTS",
    "FUNDING",
    "LOANS",
    "INVESTMENTS",
    "ASSETS",
    "ADVANCES",
  ])
    expect(rollforwardKindSchema.safeParse(kind).success).toBe(true);
  expect(rollforwardKindSchema.safeParse("PUBLIC").success).toBe(false);
});
it("posted-source reads require an actual journal identity and bounded page without free-form source or permission claims", () => {
  const body = { id: crypto.randomUUID() };
  expect(postedSourceQuerySchema.safeParse(body).success).toBe(true);
  for (const extra of [
    { id: "guessed" },
    { page: 0 },
    { sourceType: "CUSTOMER_DOCUMENT" },
    { owner: true },
  ])
    expect(
      postedSourceQuerySchema.safeParse({ ...body, ...extra }).success,
    ).toBe(false);
});
