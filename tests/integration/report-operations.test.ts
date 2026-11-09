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
const { saveReport, editReport, reportAction, reportDetail } =
  await import("@/modules/reports/service");
const { reportStatusRows, reportStatusDirectory, reportStatusQuery } =
  await import("@/modules/reports/status");
const { maintenancePass } = await import("@/server/jobs/maintenance");
const { savePreference, readAllNotifications } =
  await import("@/modules/notifications/service");
const { processOutbox } = await import("@/server/jobs/outbox");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let root: Actor,
  lead: Actor,
  member: Actor,
  other: Actor,
  taskId: string,
  foreignId: string;
const suffix = crypto.randomUUID().slice(0, 8),
  date = "2026-07-06";
const run = (actor: Actor, fn: Parameters<typeof mutate>[4]) =>
  mutate(actor, "report-ops", crypto.randomUUID(), {}, fn);
beforeAll(async () => {
  const people = [];
  for (const [name, role] of [
    ["root", "SUPER_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
    ["other", "MEMBER"],
  ] as const)
    people.push(
      await db.person.create({
        data: {
          username: `rep.${name}.${suffix}`,
          email: `rep.${name}.${suffix}@example.test`,
          displayName: "Report " + name,
          role,
          status: "ACTIVE",
        },
      }),
    );
  [root, lead, member, other] = people;
  const department = await db.department.create({
    data: {
      name: "Report department " + suffix,
      normalizedName: "report department " + suffix,
    },
  });
  const team = await db.team.create({
    data: {
      name: "Report team " + suffix,
      departmentId: department.id,
      leadId: lead.id,
    },
  });
  await db.employeeProfile.create({
    data: { userId: member.id, departmentId: department.id, teamId: team.id },
  });
  const project = await db.project.create({
    data: {
      name: "Report work " + suffix,
      description: "Synthetic",
      managerId: lead.id,
      members: { create: [lead, member].map((p) => ({ userId: p.id })) },
    },
  });
  taskId = (
    await db.task.create({
      data: {
        projectId: project.id,
        title: "Report linked work",
        description: "Synthetic",
        assigneeId: member.id,
        reviewerId: lead.id,
      },
    })
  ).id;
  foreignId = (
    await db.task.create({
      data: {
        projectId: project.id,
        title: "Other owner",
        description: "Synthetic",
        assigneeId: lead.id,
        reviewerId: member.id,
      },
    })
  ).id;
  const policy = await db.schedulePolicy.create({
    data: {
      name: "Report calendar " + suffix,
      localStart: "09:00",
      localEnd: "17:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: 0,
      closingBufferMinutes: 0,
    },
  });
  await db.scheduleAssignment.createMany({
    data: [member, other, lead].map((p) => ({
      userId: p.id,
      policyId: policy.id,
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-07-31"),
    })),
  });
});
afterAll(async () => {
  await db.person.updateMany({
    where: { id: { in: [root, lead, member, other].map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("links only owned visible tasks and creates immutable submitted versions with stored cutoff/late classification", async () => {
  await expect(
    run(member, (tx) =>
      saveReport(tx, member, {
        workDate: date,
        completedText: "Denied",
        remainingText: "",
        blockersText: "",
        taskIds: [foreignId],
      }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_TASK_LINKS" });
  const draft = (await run(member, (tx) =>
    saveReport(tx, member, {
      workDate: date,
      completedText: "Version one",
      remainingText: "",
      blockersText: "",
      taskIds: [taskId],
    }),
  )) as { id: string };
  await run(member, (tx) =>
    reportAction(tx, member, draft.id, {
      expectedVersion: 1,
      action: "submit",
    }),
  );
  const submitted = await reportDetail(member, draft.id);
  expect(submitted.late).toBe(true);
  expect(submitted.cutoffSnapshot).not.toBeNull();
  expect(submitted.tasks[0].id).toBe(taskId);
  expect(submitted.revisions).toHaveLength(1);
  await expect(
    run(member, (tx) =>
      editReport(tx, member, draft.id, {
        expectedVersion: 2,
        completedText: "Overwrite",
        remainingText: "",
        blockersText: "",
      }),
    ),
  ).rejects.toMatchObject({ code: "IMMUTABLE_REPORT" });
  await expect(reportDetail(other, draft.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("returns with a reason, preserves prior work and keeps first-submission timing after resubmission", async () => {
  const record = await db.dailyReport.findUniqueOrThrow({
    where: { userId_workDate: { userId: member.id, workDate: new Date(date) } },
  });
  await expect(
    run(lead, (tx) =>
      reportAction(tx, lead, record.id, {
        expectedVersion: 2,
        action: "return",
      }),
    ),
  ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  await run(lead, (tx) =>
    reportAction(tx, lead, record.id, {
      expectedVersion: 2,
      action: "return",
      reason: "Add remaining work",
    }),
  );
  await run(member, (tx) =>
    editReport(tx, member, record.id, {
      expectedVersion: 3,
      completedText: "Version two",
      remainingText: "Follow-up",
      blockersText: "",
      taskIds: [taskId],
    }),
  );
  await run(member, (tx) =>
    reportAction(tx, member, record.id, {
      expectedVersion: 4,
      action: "submit",
    }),
  );
  const next = await reportDetail(lead, record.id);
  expect(next.revisions).toHaveLength(2);
  expect(JSON.stringify(next.revisions)).toContain("Version one");
  expect(next.firstSubmittedAt).toEqual(record.firstSubmittedAt);
  await expect(
    run(member, (tx) =>
      reportAction(tx, member, record.id, {
        expectedVersion: 5,
        action: "acknowledge",
      }),
    ),
  ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  await run(lead, (tx) =>
    reportAction(tx, lead, record.id, {
      expectedVersion: 5,
      action: "acknowledge",
    }),
  );
});
it("calculates missing only after Karachi cutoff and keeps count/drilldown agreement", async () => {
  const before = await reportStatusRows(
      root,
      date,
      new Date(`${date}T11:59:00Z`),
    ),
    after = await reportStatusRows(root, date, new Date(`${date}T12:01:00Z`));
  expect(before.find((p) => p.id === other.id)?.status).toBe("not-due");
  expect(after.find((p) => p.id === other.id)?.status).toBe("missing");
  expect(after.find((p) => p.id === member.id)?.status).toBe("acknowledged");
  const data = await reportStatusDirectory(
    root,
    reportStatusQuery.parse({ date, status: "submitted" }),
  );
  expect(data.total).toBe(data.counts.submitted);
  expect((await reportStatusRows(other, date)).map((p) => p.id)).toEqual([
    other.id,
  ]);
});
it("excuses approved leave and holidays using the effective work calendar", async () => {
  const leaveDate = "2026-07-07";
  await db.leaveRequest.create({
    data: {
      userId: other.id,
      startDate: new Date(leaveDate),
      endDate: new Date(leaveDate),
      type: "PERSONAL",
      status: "APPROVED",
      dates: { create: { userId: other.id, workDate: new Date(leaveDate) } },
    },
  });
  expect(
    (await reportStatusRows(root, leaveDate)).find((p) => p.id === other.id),
  ).toMatchObject({ status: "excused", reason: "Approved leave" });
  await db.holiday.upsert({
    where: { date: new Date("2026-07-08") },
    create: { date: new Date("2026-07-08"), name: "Report holiday fixture" },
    update: {},
  });
  expect(
    (await reportStatusRows(root, "2026-07-08")).find((p) => p.id === other.id)
      ?.status,
  ).toBe("excused");
});
it("scopes mark-all-read and versions personal reminder preferences", async () => {
  await db.notification.createMany({
    data: [member, other, lead].map((p) => ({
      recipientId: p.id,
      eventKey: "notify-" + suffix,
      title: "Synthetic",
      target: "/notifications",
    })),
  });
  await run(member, (tx) => readAllNotifications(tx, member));
  expect(
    (
      await db.notification.findFirstOrThrow({
        where: { recipientId: other.id, eventKey: "notify-" + suffix },
      })
    ).readAt,
  ).toBeNull();
  await run(other, (tx) =>
    savePreference(tx, other, { expectedVersion: 0, reportReminders: false }),
  );
  await expect(
    run(other, (tx) =>
      savePreference(tx, other, { expectedVersion: 0, reportReminders: true }),
    ),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
});
it("durably deduplicates reminders, respects preferences, expires invitation links and recovers an interrupted lease", async () => {
  const inv = await db.invitation.create({
    data: {
      email: "expired." + suffix + "@example.test",
      username: "expired." + suffix,
      displayName: "Expired",
      role: "MEMBER",
      employmentType: "EMPLOYEE",
      tokenHash: crypto.randomUUID(),
      invitedBy: root.id,
      expiresAt: new Date(0),
    },
  });
  const mail = await db.outbox.create({
    data: {
      invitationId: inv.id,
      eventKey: "expire-" + suffix,
      recipient: inv.email,
      subject: "Expired",
      text: "Never send",
    },
  });
  const key = "report-test:" + suffix;
  await Promise.all([
    maintenancePass(date, "CLI", key),
    maintenancePass(date, "CLI", key),
  ]);
  expect(
    await db.notification.count({
      where: { recipientId: other.id, eventKey: "report-reminder:" + date },
    }),
  ).toBe(0);
  expect(
    (await db.invitation.findUniqueOrThrow({ where: { id: inv.id } }))
      .revokedAt,
  ).not.toBeNull();
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: mail.id } })).canceledAt,
  ).not.toBeNull();
  expect(
    await db.notification.count({
      where: { recipientId: lead.id, eventKey: "report-reminder:" + date },
    }),
  ).toBe(1);
  const stored = await db.maintenanceRun.findUniqueOrThrow({
    where: { runKey: key },
  });
  expect(stored.status).toBe("SUCCEEDED");
  await db.maintenanceRun.update({
    where: { id: stored.id },
    data: { status: "RUNNING", leaseUntil: new Date(0) },
  });
  await maintenancePass(date, "CLI", key);
  expect(
    (await db.maintenanceRun.findUniqueOrThrow({ where: { id: stored.id } }))
      .attempts,
  ).toBe(2);
});
it("skips disallowed recipients without consuming attempts or blocking the permitted demo inbox", async () => {
  const address = "owner." + suffix + "@example.test";
  const denied = await db.outbox.create({
    data: {
      eventKey: "denied-" + suffix,
      recipient: "other." + suffix + "@example.test",
      subject: "Synthetic",
      text: "Do not send",
    },
  });
  const allowed = await db.outbox.create({
    data: {
      eventKey: "allowed-" + suffix,
      recipient: address,
      subject: "Synthetic",
      text: "Allowed fixture",
    },
  });
  const sent: string[] = [];
  await processOutbox(
    async (mail) => {
      sent.push(mail.id);
    },
    1,
    undefined,
    address,
  );
  expect(sent).toEqual([allowed.id]);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: denied.id } })).attempts,
  ).toBe(0);
});
it("does not generate missing-report obligations for the focused HR role", async () => {
  const person = await db.person.create({
    data: {
      username: "rep.hr." + suffix,
      email: "rep.hr." + suffix + "@example.test",
      displayName: "Focused HR",
      role: "HR_ADMIN",
      status: "ACTIVE",
    },
  });
  try {
    const assignment = await db.scheduleAssignment.findFirstOrThrow({
      where: { userId: member.id },
    });
    await db.scheduleAssignment.create({
      data: {
        userId: person.id,
        policyId: assignment.policyId,
        startDate: assignment.startDate,
        endDate: assignment.endDate,
      },
    });
    expect(
      (await reportStatusRows(root, date)).some((p) => p.id === person.id),
    ).toBe(false);
    await expect(reportStatusRows(person, date)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  } finally {
    await db.person.update({
      where: { id: person.id },
      data: { status: "INACTIVE" },
    });
  }
});
