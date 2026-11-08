import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { audit, expected, type Tx } from "@/server/transaction";
import { projectFor, visibleProjects } from "@/modules/projects/service";
import { assigneeTransition, independent, type TaskState } from "./policy";
import { createTask, submitTask, reviewTask } from "./schemas";
import type { z } from "zod";
import { attachmentFields } from "@/modules/attachments/metadata";
export const visibleTasks = (actor: Actor) => ({
  project: visibleProjects(actor),
});
const detail = {
  assignee: { select: { id: true, displayName: true, username: true } },
  reviewer: { select: { id: true, displayName: true, username: true } },
  project: { select: { id: true, name: true } },
  submissions: {
    orderBy: { revision: "desc" as const },
    include: { review: true, attachments: { select: attachmentFields } },
  },
};
export async function listTasks(actor: Actor) {
  return db.task.findMany({
    where: visibleTasks(actor),
    include: detail,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
  });
}
export async function taskFor(tx: Tx, actor: Actor, id: string) {
  const initial = await tx.task.findFirst({
    where: { id, ...visibleTasks(actor) },
  });
  invariant(initial, "NOT_FOUND", "Task not found.", 404);
  const p = await projectFor(tx, initial.projectId, actor);
  invariant(!p.archivedAt, "ARCHIVED", "Archived project is read-only.", 409);
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id=${id}::uuid FOR UPDATE`;
  const task = await tx.task.findUniqueOrThrow({
    where: { id },
    include: detail,
  });
  return { task, project: p };
}
async function notify(
  tx: Tx,
  recipientId: string,
  eventKey: string,
  title: string,
  taskId: string,
) {
  await tx.notification.create({
    data: { recipientId, eventKey, title, target: `/tasks/${taskId}` },
  });
}
export async function assign(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof createTask>,
) {
  const p = await projectFor(tx, input.projectId, actor, true);
  invariant(!p.archivedAt, "ARCHIVED", "Archived project is read-only.", 409);
  independent(input.reviewerId, input.assigneeId);
  for (const id of [input.assigneeId, input.reviewerId]) {
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: p.id, userId: id } },
      include: { user: true },
    });
    invariant(
      member?.user.status === "ACTIVE",
      "INVALID_MEMBER",
      "Assignee and reviewer must be active project members.",
    );
  }
  const task = await tx.task.create({
    data: { ...input, dueAt: input.dueAt ? new Date(input.dueAt) : null },
  });
  await audit(tx, actor.id, "TASK_ASSIGNED", task.id, {
    assigneeId: task.assigneeId,
    reviewerId: task.reviewerId,
  });
  await notify(
    tx,
    task.assigneeId,
    `assignment:${task.id}`,
    "You have a new assignment",
    task.id,
  );
  return task;
}
export async function changeStatus(
  tx: Tx,
  actor: Actor,
  id: string,
  input: { expectedVersion: number; status: TaskState },
) {
  const { task } = await taskFor(tx, actor, id);
  expected(task.version, input.expectedVersion);
  invariant(
    task.assigneeId === actor.id,
    "FORBIDDEN",
    "Only the assignee can change work status.",
    403,
  );
  assigneeTransition(task.status, input.status);
  const updated = await tx.task.update({
    where: { id },
    data: { status: input.status, version: { increment: 1 } },
  });
  await audit(tx, actor.id, "TASK_STATUS_CHANGED", id, {
    from: task.status,
    to: input.status,
  });
  return updated;
}
export async function submit(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof submitTask>,
) {
  const { task } = await taskFor(tx, actor, id);
  expected(task.version, input.expectedVersion);
  invariant(
    task.assigneeId === actor.id,
    "FORBIDDEN",
    "Only the assignee can submit work.",
    403,
  );
  invariant(
    ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(task.status),
    "INVALID_TRANSITION",
    "Start the task or resolve requested changes before submitting.",
    409,
  );
  const revision = (task.submissions[0]?.revision ?? 0) + 1;
  const attachmentIds = input.attachmentIds ?? [];
  const files = await tx.attachment.findMany({
    where: {
      id: { in: attachmentIds },
      taskId: id,
      uploaderId: actor.id,
      status: "READY",
      submissionId: null,
    },
  });
  invariant(
    files.length === attachmentIds.length,
    "INVALID_ATTACHMENTS",
    "Select only your completed uploads for this task.",
    409,
  );
  const submission = await tx.submission.create({
    data: {
      taskId: id,
      submittedBy: actor.id,
      revision,
      summary: input.summary,
      artifactLinks: input.artifactLinks,
    },
  });
  if (attachmentIds.length) {
    const linked = await tx.attachment.updateMany({
      where: { id: { in: attachmentIds }, status: "READY", submissionId: null },
      data: { status: "ATTACHED", submissionId: submission.id },
    });
    invariant(
      linked.count === attachmentIds.length,
      "INVALID_ATTACHMENTS",
      "Files changed; reload and retry.",
      409,
    );
  }
  await tx.task.update({
    where: { id },
    data: { status: "IN_REVIEW", version: { increment: 1 } },
  });
  await audit(tx, actor.id, "TASK_SUBMITTED", id, {
    submissionId: submission.id,
    revision,
    attachmentIds,
  });
  await notify(
    tx,
    task.reviewerId,
    `submission:${submission.id}`,
    "Work is ready for your review",
    id,
  );
  return submission;
}
export async function review(
  tx: Tx,
  actor: Actor,
  submissionId: string,
  input: z.infer<typeof reviewTask>,
) {
  const s = await tx.submission.findUnique({ where: { id: submissionId } });
  invariant(s, "NOT_FOUND", "Submission not found.", 404);
  const { task } = await taskFor(tx, actor, s.taskId);
  expected(task.version, input.expectedVersion);
  independent(actor.id, s.submittedBy);
  invariant(
    task.reviewerId === actor.id || actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Only the designated reviewer can review.",
    403,
  );
  invariant(
    task.status === "IN_REVIEW" &&
      task.submissions[0]?.id === submissionId &&
      !task.submissions[0].review,
    "REVIEW_RESOLVED",
    "Only the latest pending submission can be reviewed.",
    409,
  );
  const decision = await tx.review.create({
    data: {
      submissionId,
      reviewerId: actor.id,
      decision: input.decision,
      feedback: input.feedback,
    },
  });
  await tx.task.update({
    where: { id: task.id },
    data: {
      status: input.decision === "APPROVE" ? "APPROVED" : "CHANGES_REQUESTED",
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, "TASK_REVIEWED", task.id, {
    decision: input.decision,
    submissionId,
    override: task.reviewerId !== actor.id,
  });
  await notify(
    tx,
    task.assigneeId,
    `review:${decision.id}`,
    "Your submission has been reviewed",
    task.id,
  );
  return decision;
}
