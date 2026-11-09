import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { listAssignments } = await import("@/modules/tasks/service");
const { assignmentQuerySchema } = await import("@/modules/tasks/queries");
const { projectDirectory } = await import("@/modules/projects/service");
const { projectQuerySchema } = await import("@/modules/projects/queries");
const { attendanceQuerySchema } = await import("@/modules/attendance/queries");
const { dashboard } = await import("@/modules/projects/dashboard");
const { check, assignSchedule } = await import("@/modules/attendance/service");
const { hrOverview } = await import("@/modules/hr/service");
const { reconcilePersonAttendance } = await import("@/server/jobs/attendance");
const { createAttendanceJob } = await import("@/server/jobs/monitoring");
const { hrApiAccess } = await import("@/lib/hr-access");
type Person = Awaited<ReturnType<typeof db.person.create>>;
let root: Person,
  lead: Person,
  member: Person,
  hr: Person,
  outsider: Person,
  projectId: string,
  policyId: string;
const suffix = crypto.randomUUID().slice(0, 8),
  date = "2026-08-03";
beforeAll(async () => {
  const people = [];
  for (const [name, role] of [
    ["root", "SUPER_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
    ["hr", "HR_ADMIN"],
    ["outsider", "MEMBER"],
  ] as const)
    people.push(
      await db.person.create({
        data: {
          username: `flow.${name}.${suffix}`,
          email: `flow.${name}.${suffix}@example.test`,
          displayName: `Flow ${name} ${suffix}`,
          role,
          status: "ACTIVE",
        },
      }),
    );
  [root, lead, member, hr, outsider] = people;
  const p = await db.project.create({
    data: {
      name: `Flow project ${suffix}`,
      description: "Synthetic directory fixture",
      managerId: lead.id,
      members: { create: [root, lead, member].map((p) => ({ userId: p.id })) },
    },
  });
  projectId = p.id;
  await db.task.createMany({
    data: Array.from({ length: 31 }, (_, n) => ({
      projectId,
      title: `Flow task ${suffix} ${n}`,
      description: "Synthetic assignment",
      assigneeId: member.id,
      reviewerId: n % 2 ? lead.id : root.id,
      status: n < 26 ? "ASSIGNED" : n < 29 ? "IN_REVIEW" : "APPROVED",
    })),
  });
  const policy = await db.schedulePolicy.create({
    data: {
      name: `Flow attendance ${suffix}`,
      localStart: "00:00",
      localEnd: "23:59",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: 0,
      closingBufferMinutes: 0,
    },
  });
  policyId = policy.id;
  // Raw legacy assignment: verify the new exemption also handles preexisting data.
  await db.scheduleAssignment.createMany({
    data: [root, lead, member, hr].map((p) => ({
      userId: p.id,
      policyId,
      startDate: new Date(date),
      endDate: new Date(date),
    })),
  });
});
afterAll(async () => {
  await db.person.updateMany({
    where: { id: { in: [root, lead, member, hr, outsider].map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("keeps card counts aligned with paginated destination lists for every work role", async () => {
  for (const actor of [root, lead, member, outsider]) {
    const counts = await dashboard(actor);
    expect(
      (await projectDirectory(actor, projectQuerySchema.parse({}))).total,
    ).toBe(counts.projects);
    for (const [view, total] of [
      ["open", counts.openTasks],
      ["review", counts.awaitingReview],
      ["approved", counts.approved],
    ] as const)
      expect(
        (await listAssignments(actor, assignmentQuerySchema.parse({ view })))
          .total,
      ).toBe(total);
  }
});
it("paginates, clamps and filters by project/search without leaking inaccessible tasks", async () => {
  const input = { project: projectId, q: suffix };
  const first = await listAssignments(
    member,
    assignmentQuerySchema.parse(input),
  );
  expect(first.total).toBe(31);
  expect(first.items).toHaveLength(25);
  const last = await listAssignments(
    member,
    assignmentQuerySchema.parse({ ...input, page: 999 }),
  );
  expect(last.page).toBe(2);
  expect(last.items).toHaveLength(6);
  expect(last.items.every((t) => !first.items.some((a) => a.id === t.id))).toBe(
    true,
  );
  expect(
    (await listAssignments(outsider, assignmentQuerySchema.parse(input))).total,
  ).toBe(0);
  expect(
    (await projectDirectory(outsider, projectQuerySchema.parse({ q: suffix })))
      .total,
  ).toBe(0);
  await expect(
    listAssignments(hr, assignmentQuerySchema.parse({})),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("shows designated reviewers only their queue and shows root every pending review", async () => {
  for (const [actor, total] of [
    [root, 3],
    [lead, 1],
    [member, 0],
  ] as const) {
    const data = await listAssignments(
      actor,
      assignmentQuerySchema.parse({ project: projectId, view: "review" }),
    );
    expect(data.total).toBe(total);
  }
  expect(
    (
      await listAssignments(
        member,
        assignmentQuerySchema.parse({ project: projectId, view: "open" }),
      )
    ).total,
  ).toBe(29);
  expect(
    (
      await listAssignments(
        member,
        assignmentQuerySchema.parse({ project: projectId, view: "approved" }),
      )
    ).total,
  ).toBe(2);
});
it("blocks both root punch operations before creating a ledger or event and rejects new root schedules", async () => {
  for (const kind of ["IN", "OUT"] as const)
    await expect(
      db.$transaction((tx) =>
        check(tx, root, kind, new Date(`${date}T05:00Z`)),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_VIEW_ONLY", status: 403 });
  expect(await db.attendanceDay.count({ where: { userId: root.id } })).toBe(0);
  expect(await db.attendanceEvent.count({ where: { userId: root.id } })).toBe(
    0,
  );
  await expect(
    db.$transaction((tx) =>
      assignSchedule(tx, root, {
        userId: root.id,
        policyId,
        startDate: "2026-08-04",
      }),
    ),
  ).rejects.toMatchObject({ code: "SUPER_ADMIN_SCHEDULE" });
});
it("allows HR, team lead and member to record their own punches, while HR mutation access stays narrow", async () => {
  for (const actor of [hr, lead, member]) {
    expect(() =>
      hrApiAccess(actor.role, "POST", "attendance/check-in"),
    ).not.toThrow();
    await db.$transaction((tx) =>
      check(tx, actor, "IN", new Date(`${date}T05:00Z`)),
    );
    const day = await db.$transaction((tx) =>
      check(tx, actor, "OUT", new Date(`${date}T06:00Z`)),
    );
    expect(day.userId).toBe(actor.id);
    expect(day.grossMinutes).toBe(60);
  }
  expect(() => hrApiAccess(hr.role, "POST", "schedule-assignments")).toThrow();
  expect(() => hrApiAccess(hr.role, "POST", "tasks")).toThrow();
});
it("staff views exclude root, include HR and honor date, search and checked status filters", async () => {
  const data = await hrOverview(
    root,
    attendanceQuerySchema.parse({ date, q: suffix, status: "checked-out" }),
  );
  expect(data.people.map((p) => p.id).sort()).toEqual(
    [hr, lead, member].map((p) => p.id).sort(),
  );
  expect(data.people.some((p) => p.id === root.id)).toBe(false);
  const search = await hrOverview(
    hr,
    attendanceQuerySchema.parse({ date, q: member.username }),
  );
  expect(search.people.map((p) => p.id)).toEqual([member.id]);
  const absent = await hrOverview(
    root,
    attendanceQuerySchema.parse({ date: "2026-08-02", q: suffix }),
  );
  expect(absent.people.every((p) => p.status === "Not checked in")).toBe(true);
});
it("excludes legacy root assignments from captured jobs and leaves historical records unchanged", async () => {
  const job = await db.$transaction((tx) =>
    createAttendanceJob(tx, root, {
      workDate: date,
      reason: "Synthetic root exemption verification",
    }),
  );
  const stored = await db.jobRun.findUniqueOrThrow({
    where: { id: job.id },
  });
  expect(stored.audience).not.toContain(root.id);
  const day = await db.attendanceDay.create({
    data: {
      userId: root.id,
      workDate: new Date(date),
      status: "ABSENT",
      snapshot: {},
    },
  });
  expect(
    await db.$transaction((tx) =>
      reconcilePersonAttendance(tx, root.id, date, new Date(`${date}T23:59Z`)),
    ),
  ).toEqual({ updated: 0 });
  expect(await db.attendanceDay.findUnique({ where: { id: day.id } })).toEqual(
    day,
  );
  // Already-captured audience must also be skipped after promotion.
  const promoted = { ...outsider, role: "SUPER_ADMIN" as const };
  await db.person.update({
    where: { id: outsider.id },
    data: { role: promoted.role },
  });
  expect(
    await db.$transaction((tx) =>
      reconcilePersonAttendance(tx, outsider.id, date, new Date()),
    ),
  ).toEqual({ updated: 0 });
});
it("rejects malformed filters and future attendance dates", () => {
  expect(assignmentQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  expect(assignmentQuerySchema.safeParse({ view: "foreign" }).success).toBe(
    false,
  );
  expect(assignmentQuerySchema.safeParse({ project: "bad" }).success).toBe(
    false,
  );
  expect(attendanceQuerySchema.safeParse({ date: "2099-01-01" }).success).toBe(
    false,
  );
  expect(attendanceQuerySchema.safeParse({ date: "2026-02-30" }).success).toBe(
    false,
  );
  expect(projectQuerySchema.safeParse({ status: "bad" }).success).toBe(false);
});
