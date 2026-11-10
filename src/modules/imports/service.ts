import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { audit, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { visibleTasks } from "@/modules/tasks/service";
import { projectFor } from "@/modules/projects/service";
import { parseCsv, csvTaskSchema } from "./csv";
export const commitSchema = z.object({ previewId: z.uuid() }).strict();
const updatesSchema = z
  .object({
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    dueAt: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .refine((v) => v.priority !== undefined || v.dueAt !== undefined, {
    message: "Choose a priority or deadline change.",
  });
export const bulkSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            expectedVersion: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine((v) => new Set(v.map((i) => i.id)).size === v.length),
    updates: updatesSchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
function manager(actor: Actor) {
  invariant(
    ["SUPER_ADMIN", "TEAM_LEAD"].includes(actor.role),
    "FORBIDDEN",
    "Project manager access required.",
    403,
  );
}
const expires = () => new Date(Date.now() + 15 * 60000);
export async function previewCsv(
  tx: Tx,
  actor: Actor,
  projectId: string,
  text: string,
) {
  manager(actor);
  const p = await projectFor(tx, projectId, actor, true);
  invariant(!p.archivedAt, "ARCHIVED", "Archived projects are read-only.", 409);
  let raw: Record<string, string>[];
  try {
    raw = parseCsv(text);
  } catch (e) {
    return {
      valid: false,
      errors: [
        { row: 0, message: e instanceof Error ? e.message : "Invalid CSV." },
      ],
      count: 0,
      sample: [],
    };
  }
  const members = await tx.projectMember.findMany({
    where: { projectId, user: { status: "ACTIVE", role: { not: "HR_ADMIN" } } },
    include: {
      user: { select: { id: true, username: true, displayName: true } },
    },
  });
  const data: {
      projectId: string;
      title: string;
      description: string;
      priority: string;
      assigneeId: string;
      reviewerId: string;
      dueAt: string | null;
    }[] = [],
    errors: { row: number; message: string }[] = [],
    sample: {
      row: number;
      title: string;
      assignee: string;
      reviewer: string;
      priority: string;
    }[] = [];
  for (const [i, row] of raw.entries()) {
    const parsed = csvTaskSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({
        row: i + 2,
        message: parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(" "),
      });
      continue;
    }
    const value = parsed.data,
      assignee = members.find((m) => m.user.username === value.assignee),
      reviewer = members.find((m) => m.user.username === value.reviewer);
    if (!assignee || !reviewer) {
      errors.push({
        row: i + 2,
        message:
          "Assignee and reviewer must be active members of this project.",
      });
      continue;
    }
    data.push({
      projectId,
      title: value.title,
      description: value.description,
      priority: value.priority,
      assigneeId: assignee.userId,
      reviewerId: reviewer.userId,
      dueAt: value.due_at ? new Date(value.due_at).toISOString() : null,
    });
    if (sample.length < 10)
      sample.push({
        row: i + 2,
        title: value.title,
        assignee: value.assignee,
        reviewer: value.reviewer,
        priority: value.priority,
      });
  }
  if (errors.length) return { valid: false, errors, count: raw.length, sample };
  const preview = await tx.changePreview.create({
    data: {
      userId: actor.id,
      kind: "TASK_IMPORT",
      payload: { projectId, tasks: data },
      expiresAt: expires(),
    },
  });
  return {
    valid: true,
    id: preview.id,
    expiresAt: preview.expiresAt,
    count: data.length,
    errors: [],
    sample,
  };
}
async function bulkRows(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof bulkSchema>,
) {
  manager(actor);
  const ids = input.items.map((i) => i.id),
    first = await tx.task.findMany({
      where: { id: { in: ids }, ...visibleTasks(actor) },
      select: { id: true, projectId: true },
    }),
    projectIds = [...new Set(first.map((t) => t.projectId))].sort();
  if (projectIds.length)
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id=ANY(${projectIds}::uuid[]) ORDER BY id FOR UPDATE`;
  const scopedIds = first.map((t) => t.id);
  if (scopedIds.length)
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id=ANY(${scopedIds}::uuid[]) ORDER BY id FOR UPDATE`;
  const rows = await tx.task.findMany({
    where: { id: { in: ids }, ...visibleTasks(actor) },
    include: { project: { select: { managerId: true, archivedAt: true } } },
  });
  const errors: { id: string; message: string }[] = [];
  for (const item of input.items) {
    const row = rows.find((r) => r.id === item.id);
    if (!row) {
      errors.push({
        id: item.id,
        message: "Task not found or outside your access.",
      });
      continue;
    }
    if (actor.role !== "SUPER_ADMIN" && row.project.managerId !== actor.id)
      errors.push({ id: item.id, message: "Project manager access required." });
    else if (
      row.project.archivedAt ||
      ["APPROVED", "CANCELED", "IN_REVIEW"].includes(row.status)
    )
      errors.push({
        id: item.id,
        message: "Task is read-only; resolve review or reopen first.",
      });
    else if (row.version !== item.expectedVersion)
      errors.push({
        id: item.id,
        message: "Task changed; reload before previewing again.",
      });
  }
  return { rows, errors, projectIds };
}
export async function previewBulk(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof bulkSchema>,
) {
  const check = await bulkRows(tx, actor, input);
  if (check.errors.length)
    return {
      valid: false,
      errors: check.errors,
      count: input.items.length,
      sample: [],
    };
  const preview = await tx.changePreview.create({
    data: {
      userId: actor.id,
      kind: "TASK_BULK",
      payload: input,
      expiresAt: expires(),
    },
  });
  return {
    valid: true,
    id: preview.id,
    expiresAt: preview.expiresAt,
    count: input.items.length,
    errors: [],
    sample: check.rows.map((r) => ({
      id: r.id,
      title: r.title,
      priority: r.priority,
      dueAt: r.dueAt?.toISOString() ?? null,
    })),
    updates: input.updates,
  };
}
export async function commitPreview(
  tx: Tx,
  actor: Actor,
  id: string,
  kind: "TASK_IMPORT" | "TASK_BULK",
) {
  manager(actor);
  await tx.$queryRaw`SELECT id FROM "ChangePreview" WHERE id=${id}::uuid FOR UPDATE`;
  const preview = await tx.changePreview.findFirst({
    where: { id, userId: actor.id, kind },
  });
  invariant(preview, "NOT_FOUND", "Preview not found.", 404);
  if (preview.committedAt) return preview.result;
  invariant(
    preview.expiresAt > new Date(),
    "PREVIEW_EXPIRED",
    "This preview expired. Preview the data again.",
    410,
  );
  let result: { count: number; ids: string[] },
    projectIds: string[] = [];
  if (kind === "TASK_BULK") {
    const input = bulkSchema.parse(preview.payload),
      check = await bulkRows(tx, actor, input);
    invariant(
      !check.errors.length,
      "BULK_CONFLICT",
      "No changes applied. One or more selected tasks changed or are no longer editable. Preview again.",
      409,
    );
    const data = {
      ...(input.updates.priority ? { priority: input.updates.priority } : {}),
      ...(input.updates.dueAt !== undefined
        ? { dueAt: input.updates.dueAt ? new Date(input.updates.dueAt) : null }
        : {}),
      version: { increment: 1 },
    };
    await tx.task.updateMany({
      where: { id: { in: input.items.map((i) => i.id) } },
      data,
    });
    await tx.audit.createMany({
      data: check.rows.map((r) => ({
        actorId: actor.id,
        action: "TASK_BULK_UPDATED",
        entityId: r.id,
        changes: {
          previewId: id,
          reason: input.reason,
          before: {
            priority: r.priority,
            dueAt: r.dueAt?.toISOString() ?? null,
          },
          after: input.updates,
        },
        requestId: crypto.randomUUID(),
      })),
    });
    result = { count: check.rows.length, ids: check.rows.map((r) => r.id) };
    projectIds = check.projectIds;
  } else {
    const payload = z
      .object({
        projectId: z.uuid(),
        tasks: z
          .array(
            z
              .object({
                projectId: z.uuid(),
                title: z.string().min(1).max(200),
                description: z.string().max(5000),
                priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
                assigneeId: z.uuid(),
                reviewerId: z.uuid(),
                dueAt: z.iso.datetime().nullable(),
              })
              .strict(),
          )
          .min(1)
          .max(500),
      })
      .strict()
      .parse(preview.payload);
    const p = await projectFor(tx, payload.projectId, actor, true);
    invariant(
      !p.archivedAt,
      "ARCHIVED",
      "Archived projects are read-only.",
      409,
    );
    const ids = [
      ...new Set(payload.tasks.flatMap((t) => [t.assigneeId, t.reviewerId])),
    ];
    await tx.$queryRaw`SELECT id FROM "Person" WHERE id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
    const members = await tx.projectMember.findMany({
      where: {
        projectId: p.id,
        user: { status: "ACTIVE", role: { not: "HR_ADMIN" } },
      },
      select: { userId: true },
    });
    invariant(
      payload.tasks.every(
        (t) =>
          t.projectId === p.id &&
          t.assigneeId !== t.reviewerId &&
          [t.assigneeId, t.reviewerId].every((v) =>
            members.some((m) => m.userId === v),
          ),
      ),
      "IMPORT_CONFLICT",
      "Membership or account status changed. No tasks imported; preview again.",
      409,
    );
    const tasks = payload.tasks.map((t) => ({
      ...t,
      id: crypto.randomUUID(),
      dueAt: t.dueAt ? new Date(t.dueAt) : null,
    }));
    await tx.task.createMany({ data: tasks });
    await tx.notification.createMany({
      data: tasks.map((t) => ({
        recipientId: t.assigneeId,
        eventKey: "assignment:" + t.id,
        title: "You have a new assignment",
        target: "/tasks/" + t.id,
      })),
    });
    await tx.audit.createMany({
      data: tasks.map((t) => ({
        actorId: actor.id,
        action: "TASK_IMPORTED",
        entityId: t.id,
        changes: {
          previewId: id,
          assigneeId: t.assigneeId,
          reviewerId: t.reviewerId,
        },
        requestId: crypto.randomUUID(),
      })),
    });
    result = { count: tasks.length, ids: tasks.map((t) => t.id) };
    projectIds = [p.id];
  }
  await tx.changePreview.update({
    where: { id },
    data: { committedAt: new Date(), result, payload: { projectIds } },
  });
  await audit(
    tx,
    actor.id,
    kind === "TASK_IMPORT" ? "TASK_IMPORT_COMMITTED" : "TASK_BULK_COMMITTED",
    id,
    { count: result.count, projectIds },
  );
  return result;
}
