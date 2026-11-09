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
const { createProject, addMember } = await import("@/modules/projects/service");
const { editProject, archiveProject, removeProjectMember, projectDetail } =
  await import("@/modules/projects/lifecycle");
const { assign, changeStatus, submit } =
  await import("@/modules/tasks/service");
const { editTask, reassignTask, managerTaskAction, addComment, taskDetail } =
  await import("@/modules/tasks/lifecycle");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let root: Actor, lead: Actor, member: Actor, reviewer: Actor, other: Actor;
const suffix = crypto.randomUUID().slice(0, 8);
const run = (
  actor: Actor,
  fn: Parameters<typeof mutate>[4],
  key = crypto.randomUUID(),
) => mutate(actor, "work-" + key, key, {}, fn);
beforeAll(async () => {
  const people = [];
  for (const [name, role] of [
    ["root", "SUPER_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
    ["reviewer", "MEMBER"],
    ["other", "MEMBER"],
  ] as const)
    people.push(
      await db.person.create({
        data: {
          username: `life.${name}.${suffix}`,
          email: `life.${name}.${suffix}@example.test`,
          displayName: name,
          role,
          status: "ACTIVE",
        },
      }),
    );
  [root, lead, member, reviewer, other] = people;
});
afterAll(async () => {
  await db.person.updateMany({
    where: {
      id: { in: [root, lead, member, reviewer, other].map((p) => p.id) },
    },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
async function fixture() {
  const project = (await run(lead, (tx) =>
    createProject(tx, lead, {
      name: "Lifecycle " + suffix,
      description: "Synthetic",
    }),
  )) as { id: string; version: number };
  for (const p of [member, reviewer])
    await run(lead, (tx) => addMember(tx, lead, project.id, p.id));
  const task = (await run(lead, (tx) =>
    assign(tx, lead, {
      projectId: project.id,
      title: "Lifecycle task",
      description: "Synthetic",
      assigneeId: member.id,
      reviewerId: reviewer.id,
      priority: "NORMAL",
    }),
  )) as { id: string; version: number };
  return { project, task };
}
it("edits scoped projects and rejects unauthorized/stale versions", async () => {
  const { project } = await fixture();
  await expect(
    run(member, (tx) =>
      editProject(tx, member, project.id, {
        expectedVersion: 1,
        name: "Denied",
        description: "",
      }),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await run(lead, (tx) =>
    editProject(tx, lead, project.id, {
      expectedVersion: 1,
      name: "Updated",
      description: "Edit",
    }),
  );
  await expect(
    run(lead, (tx) =>
      editProject(tx, lead, project.id, {
        expectedVersion: 1,
        name: "Stale",
        description: "",
      }),
    ),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
  await expect(projectDetail(other, project.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("edits and reassigns unfinished tasks using active project membership and independent reviewers", async () => {
  const { task } = await fixture();
  const fields = {
    expectedVersion: 1,
    title: "Edited",
    description: "Updated",
    priority: "HIGH" as const,
    dueAt: null,
  };
  await expect(
    run(member, (tx) => editTask(tx, member, task.id, fields)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await run(lead, (tx) => editTask(tx, lead, task.id, fields));
  await expect(
    run(lead, (tx) =>
      reassignTask(tx, lead, task.id, {
        expectedVersion: 2,
        assigneeId: other.id,
        reviewerId: reviewer.id,
        reason: "Invalid",
      }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_MEMBER" });
  const r = (await run(lead, (tx) =>
    reassignTask(tx, lead, task.id, {
      expectedVersion: 2,
      assigneeId: reviewer.id,
      reviewerId: member.id,
      reason: "Swap responsibilities",
    }),
  )) as { status: string };
  expect(r.status).toBe("ASSIGNED");
  expect((await taskDetail(member, task.id)).assigneeId).toBe(reviewer.id);
  expect(
    await db.notification.count({
      where: { recipientId: reviewer.id, target: "/tasks/" + task.id },
    }),
  ).toBe(1);
});
it("blocks reassignment during review, independently returns it and retains immutable submission evidence", async () => {
  const { task } = await fixture();
  await run(member, (tx) =>
    changeStatus(tx, member, task.id, {
      expectedVersion: 1,
      status: "IN_PROGRESS",
    }),
  );
  const submission = (await run(member, (tx) =>
    submit(tx, member, task.id, {
      expectedVersion: 2,
      summary: "First revision",
      artifactLinks: [],
    }),
  )) as { id: string };
  await expect(
    run(lead, (tx) =>
      reassignTask(tx, lead, task.id, {
        expectedVersion: 3,
        assigneeId: member.id,
        reviewerId: lead.id,
        reason: "During review",
      }),
    ),
  ).rejects.toMatchObject({ code: "READ_ONLY_TASK" });
  await run(lead, (tx) =>
    managerTaskAction(tx, lead, task.id, "return", {
      expectedVersion: 3,
      reason: "Please revise this work",
    }),
  );
  expect(
    (
      await db.review.findUniqueOrThrow({
        where: { submissionId: submission.id },
      })
    ).decision,
  ).toBe("REQUEST_CHANGES");
  expect(
    (await db.submission.findUniqueOrThrow({ where: { id: submission.id } }))
      .summary,
  ).toBe("First revision");
});
it("requires reasoned cancel/reopen, preserves comments and rejects two competing versions", async () => {
  const { task } = await fixture();
  await run(member, (tx) =>
    addComment(tx, member, task.id, { body: "Progress discussion" }),
  );
  await expect(taskDetail(other, task.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const result = await Promise.allSettled([
    run(lead, (tx) =>
      managerTaskAction(tx, lead, task.id, "cancel", {
        expectedVersion: 1,
        reason: "Scope changed",
      }),
    ),
    run(root, (tx) =>
      managerTaskAction(tx, root, task.id, "cancel", {
        expectedVersion: 1,
        reason: "Competing cancel",
      }),
    ),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await expect(
    run(member, (tx) =>
      addComment(tx, member, task.id, { body: "Denied on closed task" }),
    ),
  ).rejects.toMatchObject({ code: "READ_ONLY_TASK" });
  await run(lead, (tx) =>
    managerTaskAction(tx, lead, task.id, "reopen", {
      expectedVersion: 2,
      reason: "Resume work",
    }),
  );
  expect((await taskDetail(member, task.id)).comments[0].body).toBe(
    "Progress discussion",
  );
});
it("prevents archive with open work unless explicit cancellation and keeps archived records readable/immutable", async () => {
  const { project, task } = await fixture();
  await expect(
    run(lead, (tx) =>
      archiveProject(tx, lead, project.id, {
        expectedVersion: 1,
        reason: "Close project",
        cancelOpenTasks: false,
      }),
    ),
  ).rejects.toMatchObject({ code: "OPEN_TASKS" });
  await run(lead, (tx) =>
    archiveProject(tx, lead, project.id, {
      expectedVersion: 1,
      reason: "Explicit cancellation",
      cancelOpenTasks: true,
    }),
  );
  expect((await taskDetail(member, task.id)).status).toBe("CANCELED");
  await expect(
    run(lead, (tx) =>
      managerTaskAction(tx, lead, task.id, "reopen", {
        expectedVersion: 2,
        reason: "Denied archive",
      }),
    ),
  ).rejects.toMatchObject({ code: "ARCHIVED" });
  await run(lead, (tx) =>
    archiveProject(
      tx,
      lead,
      project.id,
      { expectedVersion: 2, reason: "Restore", cancelOpenTasks: false },
      true,
    ),
  );
  expect((await projectDetail(lead, project.id)).archivedAt).toBeNull();
  expect((await taskDetail(member, task.id)).status).toBe("CANCELED");
});
it("guards open assignments and pending reviewers, then revokes removed membership without deleting history", async () => {
  const { project, task } = await fixture();
  await expect(
    run(lead, (tx) =>
      removeProjectMember(tx, lead, project.id, member.id, {
        expectedVersion: 1,
      }),
    ),
  ).rejects.toMatchObject({ code: "OPEN_WORK" });
  await run(lead, (tx) =>
    managerTaskAction(tx, lead, task.id, "cancel", {
      expectedVersion: 1,
      reason: "Finish fixture",
    }),
  );
  await run(lead, (tx) =>
    removeProjectMember(tx, lead, project.id, member.id, {
      expectedVersion: 1,
    }),
  );
  await expect(taskDetail(member, task.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(await db.task.findUnique({ where: { id: task.id } })).not.toBeNull();
});
