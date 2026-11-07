import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated encova_test database required.");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { mutate } = await import("@/server/transaction");
const {
  createPolicy,
  check,
  requestLeave,
  decideLeave,
  requestCorrection,
  decideCorrection,
  getDay,
} = await import("@/modules/attendance/service");
const { saveReport, reportAction, editReport, reports } =
  await import("@/modules/reports/service");
let owner: Awaited<ReturnType<typeof db.person.create>>,
  hr: typeof owner,
  other: typeof owner;
const prefix = crypto.randomUUID().slice(0, 8);
const day = "2026-11-09";
let policyId: string;
const run = (
  actor: typeof owner,
  operation: string,
  fn: Parameters<typeof mutate>[4],
  key = crypto.randomUUID(),
) => mutate(actor, operation, key, {}, fn);
beforeAll(async () => {
  owner = await db.person.create({
    data: {
      username: `att.${prefix}`,
      email: `att.${prefix}@example.test`,
      displayName: "Attendance fixture",
      status: "ACTIVE",
    },
  });
  hr = await db.person.create({
    data: {
      username: `hr.${prefix}`,
      email: `hr.${prefix}@example.test`,
      displayName: "Independent HR",
      status: "ACTIVE",
      role: "HR_ADMIN",
    },
  });
  other = await db.person.create({
    data: {
      username: `other.${prefix}`,
      email: `other.${prefix}@example.test`,
      displayName: "Other fixture",
      status: "ACTIVE",
    },
  });
  const p = (await run(hr, "policy", (tx) =>
    createPolicy(tx, hr, {
      name: "Synthetic day shift",
      localStart: "09:00",
      localEnd: "17:00",
      weekdays: [1, 2, 3, 4, 5],
      graceMinutes: 15,
      closingBufferMinutes: 30,
    }),
  )) as { id: string };
  policyId = p.id;
  for (const person of [owner, other, hr])
    await db.scheduleAssignment.create({
      data: {
        userId: person.id,
        policyId,
        startDate: new Date("2026-11-01"),
        endDate: new Date("2026-12-01"),
      },
    });
});
afterAll(async () => {
  await db.$disconnect();
});
describe("Attendance and leave using real date locks", () => {
  it("rejects checkout before checkin", async () => {
    await expect(
      run(owner, "out-first", (tx) =>
        check(tx, owner, "OUT", new Date(`${day}T12:00Z`)),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CHECKOUT" });
  });
  it("concurrent identical check-in creates one event", async () => {
    const key = crypto.randomUUID();
    const results = await Promise.all(
      [1, 2].map(() =>
        run(
          owner,
          "check-in",
          (tx) => check(tx, owner, "IN", new Date(`${day}T04:00Z`)),
          key,
        ),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    expect(
      await db.attendanceEvent.count({
        where: { userId: owner.id, kind: "IN" },
      }),
    ).toBe(1);
  });
  it("records gross time with server event ordering", async () => {
    const record = (await run(owner, "check-out", (tx) =>
      check(tx, owner, "OUT", new Date(`${day}T12:00Z`)),
    )) as { grossMinutes: number; status: string };
    expect(record.grossMinutes).toBe(480);
    expect(record.status).toBe("PRESENT");
  });
  it("refuses holiday and offday events", async () => {
    await expect(
      run(owner, "weekend", (tx) =>
        check(tx, owner, "IN", new Date("2026-11-08T04:00Z")),
      ),
    ).rejects.toMatchObject({ code: "NON_WORKING_DAY" });
    await db.holiday.upsert({
      where: { date: new Date("2026-11-10") },
      create: { date: new Date("2026-11-10"), name: "Synthetic holiday" },
      update: {},
    });
    await expect(
      run(owner, "holiday", (tx) =>
        check(tx, owner, "IN", new Date("2026-11-10T04:00Z")),
      ),
    ).rejects.toMatchObject({ code: "NON_WORKING_DAY" });
  });
  it("allows only one winner between leave approval and check-in", async () => {
    const date = "2026-11-11";
    const leave = (await run(other, "leave", (tx) =>
      requestLeave(tx, other, {
        startDate: date,
        endDate: date,
        type: "PERSONAL",
      }),
    )) as { id: string };
    const results = await Promise.allSettled([
      run(hr, "approve-leave", (tx) =>
        decideLeave(tx, hr, leave.id, {
          expectedVersion: 1,
          action: "approve",
        }),
      ),
      run(other, "race-in", (tx) =>
        check(tx, other, "IN", new Date(`${date}T04:00Z`)),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const approved = await db.leaveRequest.findUniqueOrThrow({
      where: { id: leave.id },
    });
    const events = await db.attendanceEvent.count({
      where: { userId: other.id, day: { workDate: new Date(date) } },
    });
    expect(approved.status === "APPROVED" && events > 0).toBe(false);
  });
  it("prevents overlapping pending reservations", async () => {
    const input = {
      startDate: "2026-11-12",
      endDate: "2026-11-12",
      type: "PERSONAL" as const,
    };
    await run(owner, "leave-a", (tx) => requestLeave(tx, owner, input));
    await expect(
      run(owner, "leave-b", (tx) => requestLeave(tx, owner, input)),
    ).rejects.toMatchObject({ code: "LEAVE_OVERLAP" });
  });
  it("rejects self approval even for HR", async () => {
    const record = (await run(hr, "own-leave", (tx) =>
      requestLeave(tx, hr, {
        startDate: "2026-11-13",
        endDate: "2026-11-13",
        type: "SICK",
      }),
    )) as { id: string };
    await expect(
      run(hr, "own-approval", (tx) =>
        decideLeave(tx, hr, record.id, {
          expectedVersion: 1,
          action: "approve",
        }),
      ),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  });
  it("preserves raw events after independent correction", async () => {
    const record = await db.attendanceDay.findUniqueOrThrow({
      where: { userId_workDate: { userId: owner.id, workDate: new Date(day) } },
    });
    const before = await db.attendanceEvent.findMany({
      where: { dayId: record.id },
      orderBy: { kind: "asc" },
    });
    const correction = (await run(owner, "correction", (tx) =>
      requestCorrection(tx, owner, {
        attendanceDayId: record.id,
        expectedDayVersion: record.version,
        proposedIn: `${day}T04:15:00Z`,
        proposedOut: `${day}T12:00:00Z`,
        reason: "Synthetic correction fixture",
      }),
    )) as { id: string };
    await expect(
      run(owner, "self-correction", (tx) =>
        decideCorrection(tx, owner, correction.id, {
          expectedVersion: 1,
          action: "approve",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await run(hr, "correct", (tx) =>
      decideCorrection(tx, hr, correction.id, {
        expectedVersion: 1,
        action: "approve",
      }),
    );
    expect(
      await db.attendanceEvent.findMany({
        where: { dayId: record.id },
        orderBy: { kind: "asc" },
      }),
    ).toEqual(before);
    expect(
      (await db.attendanceDay.findUniqueOrThrow({ where: { id: record.id } }))
        .corrected,
    ).toBe(true);
  });
  it("rejects stale corrections without overwriting facts", async () => {
    const record = (await run(other, "day", (tx) =>
      getDay(tx, other.id, "2026-11-16"),
    )) as { id: string; version: number };
    const c = (await run(other, "stale-request", (tx) =>
      requestCorrection(tx, other, {
        attendanceDayId: record.id,
        expectedDayVersion: record.version,
        proposedIn: "2026-11-16T04:00:00Z",
        proposedOut: "2026-11-16T12:00:00Z",
        reason: "Stale fixture",
      }),
    )) as { id: string };
    await db.attendanceDay.update({
      where: { id: record.id },
      data: { version: { increment: 1 } },
    });
    await expect(
      run(hr, "stale-decision", (tx) =>
        decideCorrection(tx, hr, c.id, {
          expectedVersion: 1,
          action: "approve",
        }),
      ),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
  });
});
describe("Daily report isolation and immutability", () => {
  it("enforces one report per person/date and submitted immutability", async () => {
    const input = {
      workDate: "2026-11-06",
      completedText: "Synthetic work",
      remainingText: "",
      blockersText: "",
    };
    const r = (await run(owner, "report", (tx) =>
      saveReport(tx, owner, input),
    )) as { id: string };
    await expect(
      run(owner, "duplicate-report", (tx) => saveReport(tx, owner, input)),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    await run(owner, "submit-report", (tx) =>
      reportAction(tx, owner, r.id, { expectedVersion: 1, action: "submit" }),
    );
    await expect(
      run(owner, "edit-submitted", (tx) =>
        editReport(tx, owner, r.id, {
          expectedVersion: 2,
          completedText: "Overwrite",
          remainingText: "",
          blockersText: "",
        }),
      ),
    ).rejects.toMatchObject({ code: "IMMUTABLE_REPORT" });
    expect(await reports(other)).toHaveLength(0);
    expect(await reports(hr)).toHaveLength(0);
  });
});
