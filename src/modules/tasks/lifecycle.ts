import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { visibleTasks, taskFor } from "./service";
import { projectFor } from "@/modules/projects/service";
import { independent } from "./policy";
import { attachmentFields } from "@/modules/attachments/metadata";
const version = z.number().int().positive();
const reason = z.string().trim().min(1).max(1000);
export const editTaskSchema = z
  .object({
    expectedVersion: version,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    dueAt: z.iso.datetime().nullable(),
  })
  .strict();
export const reassignTaskSchema = z
  .object({
    expectedVersion: version,
    assigneeId: z.uuid(),
    reviewerId: z.uuid(),
    reason,
  })
  .strict();
export const taskActionSchema = z
  .object({ expectedVersion: version, reason })
  .strict();
export const commentSchema = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict();
export async function taskDetail(actor: Actor, id: string) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "Work access required.",
    403,
  );
  const item = await db.task.findFirst({
    where: { id, ...visibleTasks(actor) },
    include: {
      project: {
        select: { id: true, name: true, archivedAt: true, managerId: true },
      },
      assignee: { select: { id: true, displayName: true, username: true } },
      reviewer: { select: { id: true, displayName: true, username: true } },
      submissions: {
        orderBy: { revision: "desc" },
        include: { review: true, attachments: { select: attachmentFields } },
      },
    },
  });
  invariant(item, "NOT_FOUND", "Task not found.", 404);
  const comments = await db.taskComment.findMany({
    where: { taskId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const authors = await db.person.findMany({
    where: { id: { in: comments.map((c) => c.authorId) } },
    select: { id: true, displayName: true, username: true },
  });
  return {
    ...item,
    comments: comments.map((c) => ({
      ...c,
      author: authors.find((a) => a.id === c.authorId),
    })),
  };
}
async function managed(tx: Tx, actor: Actor, id: string, version: number) {
  const t = await tx.task.findFirst({ where: { id, ...visibleTasks(actor) } });
  invariant(t, "NOT_FOUND", "Task not found.", 404);
  await projectFor(tx, t.projectId, actor, true);
  const { task } = await taskFor(tx, actor, id);
  expected(task.version, version);
  return task;
}
async function activeMembers(
  tx: Tx,
  projectId: string,
  assigneeId: string,
  reviewerId: string,
) {
  independent(assigneeId, reviewerId);
  for (const userId of [assigneeId, reviewerId])
    invariant(
      await tx.projectMember.findFirst({
        where: { projectId, userId, user: { status: "ACTIVE" } },
      }),
      "INVALID_MEMBER",
      "Assignee and reviewer must be active project members.",
    );
}
async function notify(
  tx: Tx,
  recipientId: string,
  id: string,
  version: number,
  title: string,
) {
  await tx.notification.create({
    data: {
      recipientId,
      eventKey: `task-manager:${id}:${version}`,
      title,
      target: `/tasks/${id}`,
    },
  });
}
export async function editTask(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof editTaskSchema>,
) {
  const t = await managed(tx, actor, id, input.expectedVersion);
  invariant(
    !["APPROVED", "CANCELED", "IN_REVIEW"].includes(t.status),
    "READ_ONLY_TASK",
    "Resolve review or reopen this task before editing.",
    409,
  );
  const { expectedVersion: _, ...fields } = input;
  void _;
  const item = await tx.task.update({
    where: { id },
    data: {
      ...fields,
      dueAt: fields.dueAt ? new Date(fields.dueAt) : null,
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, "TASK_UPDATED", id, {
    before: {
      title: t.title,
      priority: t.priority,
      dueAt: t.dueAt?.toISOString() ?? null,
    },
    after: {
      title: item.title,
      priority: item.priority,
      dueAt: item.dueAt?.toISOString() ?? null,
    },
  });
  return item;
}
export async function reassignTask(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof reassignTaskSchema>,
) {
  const t = await managed(tx, actor, id, input.expectedVersion);
  invariant(
    !["APPROVED", "CANCELED", "IN_REVIEW"].includes(t.status),
    "READ_ONLY_TASK",
    "Resolve review or reopen before reassigning.",
    409,
  );
  await activeMembers(tx, t.projectId, input.assigneeId, input.reviewerId);
  const item = await tx.task.update({
    where: { id },
    data: {
      assigneeId: input.assigneeId,
      reviewerId: input.reviewerId,
      status: t.assigneeId === input.assigneeId ? t.status : "ASSIGNED",
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, "TASK_REASSIGNED", id, {
    reason: input.reason,
    before: { assigneeId: t.assigneeId, reviewerId: t.reviewerId },
    after: { assigneeId: item.assigneeId, reviewerId: item.reviewerId },
  });
  for (const recipientId of new Set([t.assigneeId, item.assigneeId]))
    await notify(
      tx,
      recipientId,
      id,
      item.version,
      "An assignment was reassigned",
    );
  return item;
}
export async function managerTaskAction(
  tx: Tx,
  actor: Actor,
  id: string,
  action: "cancel" | "reopen" | "return",
  input: z.infer<typeof taskActionSchema>,
) {
  const t = await managed(tx, actor, id, input.expectedVersion);
  let status: "CANCELED" | "IN_PROGRESS" | "ASSIGNED" | "CHANGES_REQUESTED";
  if (action === "cancel") {
    invariant(
      !["APPROVED", "CANCELED"].includes(t.status),
      "INVALID_TRANSITION",
      "Only unfinished tasks can be canceled.",
      409,
    );
    status = "CANCELED";
  } else if (action === "reopen") {
    invariant(
      ["APPROVED", "CANCELED"].includes(t.status),
      "INVALID_TRANSITION",
      "Only approved or canceled tasks can be reopened.",
      409,
    );
    await activeMembers(tx, t.projectId, t.assigneeId, t.reviewerId);
    status = t.status === "APPROVED" ? "IN_PROGRESS" : "ASSIGNED";
  } else {
    invariant(
      t.status === "IN_REVIEW",
      "INVALID_TRANSITION",
      "Only pending review can be returned.",
      409,
    );
    independent(actor.id, t.assigneeId);
    const current = t.submissions[0];
    invariant(
      current && !current.review,
      "REVIEW_RESOLVED",
      "Pending submission not found.",
      409,
    );
    await tx.review.create({
      data: {
        submissionId: current.id,
        reviewerId: actor.id,
        decision: "REQUEST_CHANGES",
        feedback: input.reason,
      },
    });
    status = "CHANGES_REQUESTED";
  }
  const item = await tx.task.update({
    where: { id },
    data: { status, version: { increment: 1 } },
  });
  await audit(
    tx,
    actor.id,
    action === "cancel"
      ? "TASK_CANCELED"
      : action === "reopen"
        ? "TASK_REOPENED"
        : "TASK_RETURNED",
    id,
    { reason: input.reason, from: t.status, to: status },
  );
  await notify(
    tx,
    t.assigneeId,
    id,
    item.version,
    action === "cancel"
      ? "An assignment was canceled"
      : action === "reopen"
        ? "An assignment was reopened"
        : "Work was returned for changes",
  );
  return item;
}
export async function addComment(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof commentSchema>,
) {
  const { task } = await taskFor(tx, actor, id);
  invariant(
    !["APPROVED", "CANCELED"].includes(task.status),
    "READ_ONLY_TASK",
    "Reopen this task before adding comments.",
    409,
  );
  const item = await tx.taskComment.create({
    data: { taskId: id, authorId: actor.id, body: input.body },
  });
  await audit(tx, actor.id, "TASK_COMMENTED", id, { commentId: item.id });
  return { id: item.id, taskId: id };
}
