import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { projectFor, visibleProjects } from "./service";
const version = z.number().int().positive();
export const editProjectSchema = z
  .object({
    expectedVersion: version,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(5000),
  })
  .strict();
export const archiveProjectSchema = z
  .object({
    expectedVersion: version,
    reason: z.string().trim().min(1).max(1000),
    cancelOpenTasks: z.boolean().default(false),
  })
  .strict();
export const projectVersionSchema = z
  .object({ expectedVersion: version })
  .strict();
export async function projectDetail(actor: Actor, id: string) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "Work access required.",
    403,
  );
  const p = await db.project.findFirst({
    where: { id, ...visibleProjects(actor) },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              username: true,
              status: true,
              role: true,
            },
          },
        },
      },
      _count: { select: { tasks: true } },
    },
  });
  invariant(p, "NOT_FOUND", "Project not found.", 404);
  return p;
}
export async function editProject(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof editProjectSchema>,
) {
  const p = await projectFor(tx, id, actor, true);
  expected(p.version, input.expectedVersion);
  invariant(
    !p.archivedAt,
    "ARCHIVED",
    "Restore this project before editing.",
    409,
  );
  const item = await tx.project.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, "PROJECT_UPDATED", id, {
    before: { name: p.name, description: p.description },
    after: { name: item.name, description: item.description },
  });
  return item;
}
export async function archiveProject(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof archiveProjectSchema>,
  restore = false,
) {
  const p = await projectFor(tx, id, actor, true);
  expected(p.version, input.expectedVersion);
  invariant(
    restore ? !!p.archivedAt : !p.archivedAt,
    "INVALID_TRANSITION",
    restore ? "Project is already active." : "Project is already archived.",
    409,
  );
  if (!restore) {
    const open = await tx.task.findMany({
      where: { projectId: id, status: { notIn: ["APPROVED", "CANCELED"] } },
      select: { id: true, assigneeId: true, version: true },
    });
    invariant(
      !open.length || input.cancelOpenTasks,
      "OPEN_TASKS",
      "Finish open tasks, or explicitly cancel them with the archive reason.",
      409,
    );
    if (open.length) {
      await tx.task.updateMany({
        where: { id: { in: open.map((t) => t.id) } },
        data: { status: "CANCELED", version: { increment: 1 } },
      });
      await tx.notification.createMany({
        data: open.map((t) => ({
          recipientId: t.assigneeId,
          eventKey: `cancel:${t.id}:${t.version + 1}`,
          title: "An assignment was canceled",
          target: `/tasks/${t.id}`,
        })),
        skipDuplicates: true,
      });
      await tx.audit.createMany({
        data: open.map((t) => ({
          actorId: actor.id,
          action: "TASK_CANCELED",
          entityId: t.id,
          changes: { reason: input.reason, projectArchive: id },
          requestId: crypto.randomUUID(),
        })),
      });
    }
  }
  const item = await tx.project.update({
    where: { id },
    data: {
      archivedAt: restore ? null : new Date(),
      version: { increment: 1 },
    },
  });
  await audit(
    tx,
    actor.id,
    restore ? "PROJECT_RESTORED" : "PROJECT_ARCHIVED",
    id,
    {
      reason: input.reason,
      cancelOpenTasks: !restore && input.cancelOpenTasks,
    },
  );
  return item;
}
export async function removeProjectMember(
  tx: Tx,
  actor: Actor,
  id: string,
  userId: string,
  input: z.infer<typeof projectVersionSchema>,
) {
  const p = await projectFor(tx, id, actor, true);
  expected(p.version, input.expectedVersion);
  invariant(!p.archivedAt, "ARCHIVED", "Archived projects are read-only.", 409);
  invariant(
    p.managerId !== userId,
    "PROJECT_MANAGER",
    "The project manager must remain a member.",
  );
  invariant(
    await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId } },
    }),
    "NOT_FOUND",
    "Project member not found.",
    404,
  );
  invariant(
    !(await tx.task.count({
      where: {
        projectId: id,
        OR: [
          { assigneeId: userId, status: { notIn: ["APPROVED", "CANCELED"] } },
          { reviewerId: userId, status: "IN_REVIEW" },
        ],
      },
    })),
    "OPEN_WORK",
    "Reassign open work and resolve pending reviews before removing this member.",
    409,
  );
  await tx.projectMember.delete({
    where: { projectId_userId: { projectId: id, userId } },
  });
  await tx.project.update({
    where: { id },
    data: { version: { increment: 1 } },
  });
  await audit(tx, actor.id, "PROJECT_MEMBER_REMOVED", id, { userId });
  return { projectId: id, userId, removed: true };
}
