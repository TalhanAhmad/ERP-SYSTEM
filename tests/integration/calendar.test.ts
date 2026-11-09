import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { mutate } = await import("@/server/transaction");
const { replaceSchedule, saveHoliday, removeHoliday } =
  await import("@/modules/attendance/calendar");
const { getDay, assignSchedule } = await import("@/modules/attendance/service");
const { workDate } = await import("@/lib/dates");
type Person = Awaited<ReturnType<typeof db.person.create>>;
let root: Person, member: Person, oldId: string, newId: string;
const suffix = crypto.randomUUID().slice(0, 8);
const start = new Date(
  new Date(workDate()).getTime() +
    (400 + Math.floor(Math.random() * 1000)) * 86400000,
);
const date = (n: number) =>
  new Date(start.getTime() + n * 86400000).toISOString().slice(0, 10);
const run = (
  actor: Person,
  fn: Parameters<typeof mutate>[4],
  key = crypto.randomUUID(),
) => mutate(actor, "calendar-" + key, key, {}, fn);
beforeAll(async () => {
  for (const role of ["SUPER_ADMIN", "MEMBER"] as const) {
    const p = await db.person.create({
      data: {
        username: `cal.${role.toLowerCase()}.${suffix}`,
        email: `cal.${role.toLowerCase()}.${suffix}@example.test`,
        displayName: "Calendar fixture",
        status: "ACTIVE",
        role,
      },
    });
    if (role === "SUPER_ADMIN") root = p;
    else member = p;
  }
  const policy = {
    localStart: "09:00",
    localEnd: "17:00",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    graceMinutes: 0,
    closingBufferMinutes: 0,
  };
  oldId = (
    await db.schedulePolicy.create({
      data: { ...policy, name: "Calendar old " + suffix },
    })
  ).id;
  newId = (
    await db.schedulePolicy.create({
      data: { ...policy, name: "Calendar new " + suffix, localStart: "10:00" },
    })
  ).id;
});
afterAll(async () => {
  await db.person.updateMany({
    where: { id: { in: [root.id, member.id] } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("splits prospectively, preserves the original range/snapshot and rejects stale edits", async () => {
  const a = await db.scheduleAssignment.create({
    data: {
      userId: member.id,
      policyId: oldId,
      startDate: start,
      endDate: new Date(date(9)),
    },
  });
  const day = await db.$transaction((tx) => getDay(tx, member.id, date(0)));
  const result = (await run(root, (tx) =>
    replaceSchedule(tx, root, a.id, {
      expectedVersion: 1,
      policyId: newId,
      effectiveDate: date(3),
      reason: "New shift",
    }),
  )) as { id: string };
  expect(
    (
      await db.scheduleAssignment.findUniqueOrThrow({ where: { id: a.id } })
    ).endDate
      ?.toISOString()
      .slice(0, 10),
  ).toBe(date(2));
  expect(
    (
      await db.scheduleAssignment.findUniqueOrThrow({
        where: { id: result.id },
      })
    ).policyId,
  ).toBe(newId);
  expect(await db.attendanceDay.findUnique({ where: { id: day.id } })).toEqual(
    day,
  );
  await expect(
    run(root, (tx) =>
      replaceSchedule(tx, root, a.id, {
        expectedVersion: 1,
        policyId: newId,
        effectiveDate: date(1),
        reason: "Stale",
      }),
    ),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
});
it("rejects recorded dates and pending/approved leave reservations without altering the range", async () => {
  const a = await db.scheduleAssignment.findFirstOrThrow({
    where: { userId: member.id, startDate: start },
  });
  await expect(
    run(root, (tx) =>
      replaceSchedule(tx, root, a.id, {
        expectedVersion: a.version,
        policyId: newId,
        effectiveDate: date(0),
        reason: "Blocked",
      }),
    ),
  ).rejects.toMatchObject({ code: "RECORDED_CALENDAR" });
  const leave = await db.leaveRequest.create({
    data: {
      userId: member.id,
      startDate: new Date(date(5)),
      endDate: new Date(date(5)),
      type: "PERSONAL",
      dates: { create: { userId: member.id, workDate: new Date(date(5)) } },
    },
  });
  const replacement = await db.scheduleAssignment.findFirstOrThrow({
    where: { userId: member.id, policyId: newId },
  });
  await expect(
    run(root, (tx) =>
      replaceSchedule(tx, root, replacement.id, {
        expectedVersion: 1,
        policyId: oldId,
        effectiveDate: date(4),
        reason: "Blocked leave",
      }),
    ),
  ).rejects.toMatchObject({ code: "RECORDED_CALENDAR" });
  await db.leaveDate.updateMany({
    where: { requestId: leave.id },
    data: { active: false },
  });
});
it("serializes competing replacements and blocks overlap with another assignment", async () => {
  const a = await db.scheduleAssignment.create({
    data: {
      userId: member.id,
      policyId: oldId,
      startDate: new Date(date(10)),
      endDate: new Date(date(19)),
    },
  });
  const input = {
    expectedVersion: 1,
    policyId: newId,
    effectiveDate: date(10),
    reason: "Concurrent replacement",
  };
  const results = await Promise.allSettled([
    run(root, (tx) => replaceSchedule(tx, root, a.id, input)),
    run(root, (tx) => replaceSchedule(tx, root, a.id, input)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await run(root, (tx) =>
    assignSchedule(tx, root, {
      userId: member.id,
      policyId: oldId,
      startDate: date(20),
      endDate: date(29),
    }),
  );
  await expect(
    run(root, (tx) =>
      replaceSchedule(tx, root, a.id, {
        ...input,
        expectedVersion: 2,
        endDate: date(22),
      }),
    ),
  ).rejects.toMatchObject({ code: "SCHEDULE_OVERLAP" });
});
it("denies member calendar writes and historical/root schedule replacement", async () => {
  const a = await db.scheduleAssignment.findFirstOrThrow({
    where: { userId: member.id },
  });
  await expect(
    run(member, (tx) =>
      replaceSchedule(tx, member, a.id, {
        expectedVersion: a.version,
        policyId: newId,
        effectiveDate: date(1),
        reason: "Denied",
      }),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    run(root, (tx) =>
      saveHoliday(tx, root, { date: "2020-01-01", name: "Historical" }),
    ),
  ).rejects.toMatchObject({ code: "HISTORICAL_HOLIDAY" });
});
it("creates, versions and removes an unrecorded future holiday", async () => {
  const item = (await run(root, (tx) =>
    saveHoliday(tx, root, { date: date(35), name: "New holiday " + suffix }),
  )) as { id: string };
  const edit = (await run(root, (tx) =>
    saveHoliday(
      tx,
      root,
      { date: date(36), name: "Moved holiday" },
      item.id,
      1,
    ),
  )) as { version: number };
  expect(edit.version).toBe(2);
  await expect(
    run(root, (tx) => removeHoliday(tx, root, item.id, { expectedVersion: 1 })),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
  await run(root, (tx) =>
    removeHoliday(tx, root, item.id, { expectedVersion: 2 }),
  );
  expect(await db.holiday.findUnique({ where: { id: item.id } })).toBeNull();
});
it("does not add/remove holidays over recorded attendance and retains that snapshot", async () => {
  const record = await db.attendanceDay.findFirstOrThrow({
    where: { userId: member.id, workDate: start },
  });
  await expect(
    run(root, (tx) =>
      saveHoliday(tx, root, { date: date(0), name: "Blocked" }),
    ),
  ).rejects.toMatchObject({ code: "RECORDED_CALENDAR" });
  expect(
    await db.attendanceDay.findUnique({ where: { id: record.id } }),
  ).toEqual(record);
});
