import { describe, it, expect } from "vitest";
import {
  calculate,
  policySchema,
  type Snapshot,
} from "@/modules/attendance/schemas";
const policy: Snapshot = {
  start: "2026-11-09T09:00:00+05:00",
  end: "2026-11-09T17:00:00+05:00",
  policyId: crypto.randomUUID(),
  graceMinutes: 15,
  closingBufferMinutes: 30,
  kind: "WORKDAY",
};
describe("Attendance summaries", () => {
  it("does not fabricate a checkout after closing", () =>
    expect(
      calculate(
        policy,
        new Date("2026-11-09T04:00Z"),
        null,
        new Date("2026-11-09T13:00Z"),
      ).status,
    ).toBe("NEEDS_REVIEW"));
  it("marks a no-event day absent only after the closing buffer", () => {
    expect(
      calculate(policy, null, null, new Date("2026-11-09T12:15Z")).status,
    ).toBe("NOT_DUE");
    expect(
      calculate(policy, null, null, new Date("2026-11-09T12:31Z")).status,
    ).toBe("ABSENT");
  });
  it("separates lateness and early departure from present status", () =>
    expect(
      calculate(
        policy,
        new Date("2026-11-09T04:16Z"),
        new Date("2026-11-09T11:00Z"),
        new Date("2026-11-09T11:00Z"),
      ),
    ).toMatchObject({
      status: "PRESENT",
      late: true,
      early: true,
      grossMinutes: 404,
    }));
  it("does not mark off-days absent", () =>
    expect(
      calculate(
        { ...policy, kind: "OFF_DAY" },
        null,
        null,
        new Date("2026-11-09T15:00Z"),
      ).status,
    ).toBe("OFF_DAY"));
  it("rejects overnight schedules", () =>
    expect(
      policySchema.safeParse({
        name: "Overnight",
        localStart: "22:00",
        localEnd: "06:00",
        weekdays: [1],
        graceMinutes: 0,
        closingBufferMinutes: 0,
      }).success,
    ).toBe(false));
});
