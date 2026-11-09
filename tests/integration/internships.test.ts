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
const {
  saveEnrollment,
  saveMilestone,
  milestoneAction,
  saveFeedback,
  internshipDetail,
  feedbackSchema,
} = await import("@/modules/internships/service");
const { changeStatus, submit, review } =
  await import("@/modules/tasks/service");
const { workDate } = await import("@/lib/dates");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let root: Actor,
  root2: Actor,
  mentor: Actor,
  mentor2: Actor,
  outsider: Actor,
  departmentId: string;
const created: Actor[] = [],
  suffix = crypto.randomUUID().slice(0, 8);
let count = 0;
const today = workDate(),
  date = (offset: number) =>
    new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
const run = (actor: Actor, fn: Parameters<typeof mutate>[4]) =>
  mutate(actor, "learn", crypto.randomUUID(), {}, fn);
async function person(
  name: string,
  role: "SUPER_ADMIN" | "TEAM_LEAD" | "MEMBER" = "MEMBER",
  employmentType = "EMPLOYEE",
) {
  const p = await db.person.create({
    data: {
      username: `learn.${name}.${suffix}`,
      email: `learn.${name}.${suffix}@example.test`,
      displayName: name,
      role,
      status: "ACTIVE",
      employmentType,
    },
  });
  created.push(p);
  return p;
}
beforeAll(async () => {
  root = await person("root", "SUPER_ADMIN");
  root2 = await person("root2", "SUPER_ADMIN");
  mentor = await person("mentor", "TEAM_LEAD");
  mentor2 = await person("mentor2", "TEAM_LEAD");
  outsider = await person("outside");
  departmentId = (
    await db.department.create({
      data: {
        name: "Learning " + suffix,
        normalizedName: "learning " + suffix,
      },
    })
  ).id;
});
afterAll(async () => {
  await db.person.updateMany({
    where: { id: { in: created.map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
async function fixture() {
  const intern = await person("intern" + ++count, "MEMBER", "INTERN");
  const input = {
    expectedVersion: 0,
    internId: intern.id,
    mentorId: mentor.id,
    departmentId,
    startDate: date(-3),
    endDate: date(30),
    objective: "Learn through independently approved work",
    status: "ACTIVE" as const,
  };
  const enrollment = (await run(root, (tx) =>
    saveEnrollment(tx, root, input),
  )) as { id: string; version: number };
  const project = await db.project.create({
    data: {
      name: "Learning fixture " + count,
      description: "Synthetic",
      managerId: mentor.id,
      members: { create: [mentor, intern].map((p) => ({ userId: p.id })) },
    },
  });
  const task = await db.task.create({
    data: {
      projectId: project.id,
      title: "Required learning work",
      description: "Synthetic",
      assigneeId: intern.id,
      reviewerId: mentor.id,
    },
  });
  return { intern, input, enrollment, task };
}
it("enforces one active enrollment, intern designation and independent privileged mentors", async () => {
  const f = await fixture();
  await expect(
    run(root, (tx) => saveEnrollment(tx, root, f.input)),
  ).rejects.toMatchObject({ code: "ACTIVE_ENROLLMENT" });
  await expect(
    run(root, (tx) =>
      saveEnrollment(tx, root, { ...f.input, internId: outsider.id }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_INTERN" });
  await expect(
    run(root, (tx) =>
      saveEnrollment(tx, root, { ...f.input, mentorId: f.intern.id }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_MENTOR" });
});
it("allows only the current mentor, intern and root to read learning records", async () => {
  const f = await fixture();
  expect((await internshipDetail(f.intern, f.enrollment.id)).internId).toBe(
    f.intern.id,
  );
  expect((await internshipDetail(mentor, f.enrollment.id)).canMentor).toBe(
    true,
  );
  await expect(
    internshipDetail(outsider, f.enrollment.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    internshipDetail(mentor2, f.enrollment.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("keeps milestone task evidence scoped and prevents intern editing of their own learning plan", async () => {
  const f = await fixture();
  const plan = {
    expectedVersion: 0,
    title: "Ship tested work",
    description: "Independent evidence",
    dueDate: date(7),
    taskIds: [f.task.id],
  };
  await expect(
    run(f.intern, (tx) => saveMilestone(tx, f.intern, f.enrollment.id, plan)),
  ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  const foreign = await db.task.create({
    data: {
      projectId: f.task.projectId,
      title: "Someone else work",
      description: "Synthetic",
      assigneeId: mentor.id,
      reviewerId: f.intern.id,
    },
  });
  await expect(
    run(mentor, (tx) =>
      saveMilestone(tx, mentor, f.enrollment.id, {
        ...plan,
        taskIds: [foreign.id],
      }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
  await expect(
    run(mentor, (tx) =>
      saveMilestone(tx, mentor, f.enrollment.id, {
        ...plan,
        dueDate: date(31),
      }),
    ),
  ).rejects.toMatchObject({ code: "MILESTONE_DATES" });
});
it("requires intern submission, all approved linked tasks and an explained independent root override", async () => {
  const f = await fixture();
  const milestone = (await run(mentor, (tx) =>
    saveMilestone(tx, mentor, f.enrollment.id, {
      expectedVersion: 0,
      title: "Evidence flow",
      description: "Synthetic",
      dueDate: date(7),
      taskIds: [f.task.id],
    }),
  )) as { id: string };
  await run(mentor, (tx) =>
    milestoneAction(tx, mentor, milestone.id, {
      expectedVersion: 1,
      status: "ACTIVE",
    }),
  );
  await expect(
    run(f.intern, (tx) =>
      milestoneAction(tx, f.intern, milestone.id, {
        expectedVersion: 2,
        status: "SUBMITTED",
      }),
    ),
  ).rejects.toMatchObject({ code: "EVIDENCE_NOT_READY" });
  await run(f.intern, (tx) =>
    changeStatus(tx, f.intern, f.task.id, {
      expectedVersion: 1,
      status: "IN_PROGRESS",
    }),
  );
  const submitted = (await run(f.intern, (tx) =>
    submit(tx, f.intern, f.task.id, {
      expectedVersion: 2,
      summary: "Intern work",
      artifactLinks: [],
    }),
  )) as { id: string };
  await run(f.intern, (tx) =>
    milestoneAction(tx, f.intern, milestone.id, {
      expectedVersion: 2,
      status: "SUBMITTED",
    }),
  );
  await expect(
    run(mentor, (tx) =>
      milestoneAction(tx, mentor, milestone.id, {
        expectedVersion: 3,
        status: "COMPLETED",
      }),
    ),
  ).rejects.toMatchObject({ code: "UNAPPROVED_EVIDENCE" });
  await run(mentor, (tx) =>
    review(tx, mentor, submitted.id, {
      expectedVersion: 3,
      decision: "APPROVE",
      feedback: "Verified",
    }),
  );
  await expect(
    run(f.intern, (tx) =>
      milestoneAction(tx, f.intern, milestone.id, {
        expectedVersion: 3,
        status: "COMPLETED",
      }),
    ),
  ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  await expect(
    run(root, (tx) =>
      milestoneAction(tx, root, milestone.id, {
        expectedVersion: 3,
        status: "COMPLETED",
      }),
    ),
  ).rejects.toMatchObject({ code: "OVERRIDE_REASON" });
  await run(root, (tx) =>
    milestoneAction(tx, root, milestone.id, {
      expectedVersion: 3,
      status: "COMPLETED",
      reason: "Independent Super Admin evidence review",
    }),
  );
  expect(
    (
      await db.learningMilestone.findUniqueOrThrow({
        where: { id: milestone.id },
      })
    ).completedBy,
  ).toBe(root.id);
  expect(
    await db.audit.count({
      where: { entityId: milestone.id, action: "MILESTONE_EVIDENCE_VERIFIED" },
    }),
  ).toBe(1);
});
it("keeps weekly feedback private, week-bound, versioned and ratings explained", async () => {
  const f = await fixture();
  let monday = new Date(today);
  monday = new Date(
    monday.getTime() - ((monday.getUTCDay() + 6) % 7) * 86400000,
  );
  const body = {
    expectedVersion: 0,
    weekStart: monday.toISOString().slice(0, 10),
    strengths: "Clear implementation",
    improvements: "Boundary tests",
    nextActions: "Add cases",
    rating: null,
    ratingExplanation: null,
  };
  expect(feedbackSchema.safeParse({ ...body, rating: 5 }).success).toBe(false);
  await run(mentor, (tx) => saveFeedback(tx, mentor, f.enrollment.id, body));
  await expect(
    run(mentor, (tx) => saveFeedback(tx, mentor, f.enrollment.id, body)),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
  await expect(
    run(f.intern, (tx) =>
      saveFeedback(tx, f.intern, f.enrollment.id, {
        ...body,
        expectedVersion: 1,
      }),
    ),
  ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  expect(
    (await internshipDetail(f.intern, f.enrollment.id)).feedback,
  ).toHaveLength(1);
  const audit = await db.audit.findFirstOrThrow({
    where: {
      action: "INTERNSHIP_FEEDBACK_SAVED",
      changes: { path: ["internshipId"], equals: f.enrollment.id },
    },
  });
  expect(JSON.stringify(audit.changes)).not.toContain(body.strengths);
});
it("moves mentor access immediately and preserves historical feedback on reassignment", async () => {
  const f = await fixture();
  await run(root, (tx) =>
    saveEnrollment(
      tx,
      root,
      {
        ...f.input,
        expectedVersion: 1,
        mentorId: mentor2.id,
        reason: "Assign the current mentor",
      },
      f.enrollment.id,
    ),
  );
  await expect(internshipDetail(mentor, f.enrollment.id)).rejects.toMatchObject(
    { code: "NOT_FOUND" },
  );
  expect((await internshipDetail(mentor2, f.enrollment.id)).canMentor).toBe(
    true,
  );
});
it("blocks enrollment completion with unfinished milestones and preserves canceled enrollment history", async () => {
  const f = await fixture();
  await expect(
    run(root, (tx) =>
      saveEnrollment(
        tx,
        root,
        {
          ...f.input,
          expectedVersion: 1,
          status: "COMPLETED",
          reason: "Too early",
        },
        f.enrollment.id,
      ),
    ),
  ).rejects.toMatchObject({ code: "INCOMPLETE_MILESTONES" });
  await run(root, (tx) =>
    saveEnrollment(
      tx,
      root,
      {
        ...f.input,
        expectedVersion: 1,
        status: "CANCELED",
        reason: "Retain closed history",
      },
      f.enrollment.id,
    ),
  );
  expect((await internshipDetail(f.intern, f.enrollment.id)).status).toBe(
    "CANCELED",
  );
  await expect(
    run(mentor, (tx) =>
      saveMilestone(tx, mentor, f.enrollment.id, {
        expectedVersion: 0,
        title: "Denied",
        description: "",
        dueDate: date(1),
        taskIds: [],
      }),
    ),
  ).rejects.toMatchObject({ code: "READ_ONLY_INTERNSHIP" });
});
it("serializes concurrent enrollments from different administrators", async () => {
  const intern = await person("race" + ++count, "MEMBER", "INTERN"),
    input = {
      expectedVersion: 0,
      internId: intern.id,
      mentorId: mentor.id,
      departmentId,
      startDate: today,
      endDate: date(10),
      objective: "Concurrent enrollment",
      status: "ACTIVE" as const,
    };
  const results = await Promise.allSettled([
    run(root, (tx) => saveEnrollment(tx, root, input)),
    run(root2, (tx) => saveEnrollment(tx, root2, input)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.internship.count({
      where: { internId: intern.id, status: "ACTIVE" },
    }),
  ).toBe(1);
});
it("requires an explicit reason when Root overrides a task designated to another reviewer", async () => {
  const f = await fixture();
  await run(f.intern, (tx) =>
    changeStatus(tx, f.intern, f.task.id, {
      expectedVersion: 1,
      status: "IN_PROGRESS",
    }),
  );
  const submission = (await run(f.intern, (tx) =>
    submit(tx, f.intern, f.task.id, {
      expectedVersion: 2,
      summary: "Independent override case",
      artifactLinks: [],
    }),
  )) as { id: string };
  await expect(
    run(root, (tx) =>
      review(tx, root, submission.id, {
        expectedVersion: 3,
        decision: "APPROVE",
        feedback: "Reviewed",
      }),
    ),
  ).rejects.toMatchObject({ code: "OVERRIDE_REASON" });
  await run(root, (tx) =>
    review(tx, root, submission.id, {
      expectedVersion: 3,
      decision: "APPROVE",
      feedback: "Reviewed",
      overrideReason: "Independent substitute reviewer",
    }),
  );
  const log = await db.audit.findFirstOrThrow({
    where: { entityId: f.task.id, action: "TASK_REVIEWED" },
  });
  expect(log.changes).toMatchObject({
    override: true,
    overrideReason: "Independent substitute reviewer",
  });
});
