import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { independent } from "@/modules/tasks/policy";
import { workDate } from "@/lib/dates";
import { visibleTasks } from "@/modules/tasks/service";
export const reportSchema = z
  .object({
    workDate: z.iso.date(),
    completedText: z.string().max(5000),
    remainingText: z.string().max(5000),
    blockersText: z.string().max(5000),
    taskIds: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
  })
  .strict();
export async function reportScope(actor: Actor, tx: Tx = db) {
  if (actor.role === "SUPER_ADMIN") return {};
  if (actor.role !== "TEAM_LEAD") return { userId: { in: [actor.id] } };
  const teams = await tx.team.findMany({
    where: { leadId: actor.id, archivedAt: null },
    select: { id: true },
  });
  const members = await tx.employeeProfile.findMany({
    where: { teamId: { in: teams.map((t) => t.id) } },
    select: { userId: true },
  });
  return { userId: { in: [actor.id, ...members.map((p) => p.userId)] } };
}
export async function reports(actor: Actor) {
  return db.dailyReport.findMany({
    where: await reportScope(actor),
    orderBy: [{ workDate: "desc" }, { id: "asc" }],
    take: 100,
  });
}
export async function saveReport(
  tx: Tx,
  actor: Actor,
  input: z.input<typeof reportSchema>,
) {
  invariant(
    input.workDate <= workDate(),
    "FUTURE_REPORT",
    "Reports cannot be written for future dates.",
  );
  const { taskIds = [], ...fields } = input;
  await validTasks(tx, actor, taskIds);
  const record = await tx.dailyReport.create({
    data: {
      ...fields,
      userId: actor.id,
      workDate: new Date(`${input.workDate}T00:00:00Z`),
    },
  });
  if (taskIds.length)
    await tx.reportTask.createMany({
      data: taskIds.map((taskId) => ({ reportId: record.id, taskId })),
    });
  await audit(tx, actor.id, "REPORT_DRAFTED", record.id);
  return record;
}
export async function editReport(
  tx: Tx,
  actor: Actor,
  id: string,
  input: {
    expectedVersion: number;
    completedText: string;
    remainingText: string;
    blockersText: string;
    taskIds?: string[];
  },
) {
  const record = await tx.dailyReport.findFirst({
    where: { id, userId: actor.id },
  });
  invariant(record, "NOT_FOUND", "Report not found.", 404);
  expected(record.version, input.expectedVersion);
  invariant(
    record.status === "DRAFT",
    "IMMUTABLE_REPORT",
    "Submitted reports cannot be edited.",
    409,
  );
  const { expectedVersion: _, taskIds, ...fields } = input;
  void _;
  if (taskIds) {
    await validTasks(tx, actor, taskIds);
    await tx.reportTask.deleteMany({ where: { reportId: id } });
    if (taskIds.length)
      await tx.reportTask.createMany({
        data: taskIds.map((taskId) => ({ reportId: id, taskId })),
      });
  }
  const updated = await tx.dailyReport.update({
    where: { id },
    data: { ...fields, version: { increment: 1 } },
  });
  await audit(tx, actor.id, "REPORT_EDITED", id, { version: updated.version });
  return updated;
}
export async function reportAction(
  tx: Tx,
  actor: Actor,
  id: string,
  input: {
    expectedVersion: number;
    action: "submit" | "acknowledge" | "return";
    reason?: string;
  },
) {
  await tx.$queryRaw`SELECT id FROM "DailyReport" WHERE id=${id}::uuid FOR UPDATE`;
  const record = await tx.dailyReport.findFirst({
    where: { id, ...(await reportScope(actor, tx)) },
  });
  invariant(record, "NOT_FOUND", "Report not found.", 404);
  expected(record.version, input.expectedVersion);
  if (input.action === "submit") {
    invariant(
      record.userId === actor.id,
      "FORBIDDEN",
      "Only the author can submit.",
      403,
    );
    invariant(
      record.status === "DRAFT",
      "INVALID_TRANSITION",
      "This report is already submitted.",
      409,
    );
    invariant(
      record.completedText.trim() ||
        record.remainingText.trim() ||
        record.blockersText.trim(),
      "EMPTY_REPORT",
      "Describe your work before submitting.",
    );
  } else {
    independent(actor.id, record.userId);
    invariant(
      record.status === "SUBMITTED",
      "INVALID_TRANSITION",
      "Only a submitted report can be reviewed.",
      409,
    );
  }
  if (input.action === "return")
    invariant(
      input.reason?.trim(),
      "REASON_REQUIRED",
      "Explain why this report needs revision.",
    );
  const timing: {
    firstSubmittedAt?: Date;
    cutoffSnapshot?: string;
    late?: boolean;
  } = {};
  if (input.action === "submit" && !record.firstSubmittedAt) {
    const settings = await tx.companySettings.findUniqueOrThrow({
      where: { id: "workspace" },
    });
    timing.firstSubmittedAt = new Date();
    timing.cutoffSnapshot = settings.reportCutoff;
    timing.late =
      timing.firstSubmittedAt >
      new Date(
        `${record.workDate.toISOString().slice(0, 10)}T${settings.reportCutoff}:00+05:00`,
      );
  }
  const status =
    input.action === "submit"
      ? "SUBMITTED"
      : input.action === "return"
        ? "DRAFT"
        : "ACKNOWLEDGED";
  const updated = await tx.dailyReport.update({
    where: { id },
    data: {
      status,
      ...timing,
      ...(input.action === "submit" ? { submittedAt: new Date() } : {}),
      acknowledgedBy: input.action === "acknowledge" ? actor.id : null,
      version: { increment: 1 },
    },
  });
  if (input.action === "submit") {
    const links = await tx.reportTask.findMany({
      where: { reportId: id },
      select: { taskId: true },
    });
    await tx.reportRevision.create({
      data: {
        reportId: id,
        version: updated.version,
        content: {
          completedText: record.completedText,
          remainingText: record.remainingText,
          blockersText: record.blockersText,
          taskIds: links.map((l) => l.taskId),
          submittedAt: updated.submittedAt!.toISOString(),
          late: updated.late,
          cutoffSnapshot: updated.cutoffSnapshot,
        },
      },
    });
  }
  await audit(tx, actor.id, `REPORT_${input.action.toUpperCase()}`, id, {
    from: record.status,
    to: status,
    ...(input.reason ? { reason: input.reason } : {}),
  });
  if (input.action !== "submit")
    await tx.notification.create({
      data: {
        recipientId: record.userId,
        eventKey: `report:${id}:${updated.version}`,
        title:
          input.action === "return"
            ? "Your report needs revision"
            : "Your report was acknowledged",
        target: "/reports/" + id,
      },
    });
  return updated;
}

async function validTasks(tx: Tx, actor: Actor, ids: string[]) {
  invariant(
    ids.length <= 100 && new Set(ids).size === ids.length,
    "INVALID_TASK_LINKS",
    "Choose up to 100 distinct tasks.",
  );
  invariant(
    (await tx.task.count({
      where: { id: { in: ids }, assigneeId: actor.id, ...visibleTasks(actor) },
    })) === ids.length,
    "INVALID_TASK_LINKS",
    "Link only your currently accessible assignments.",
  );
}
export async function reportDetail(actor: Actor, id: string) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "Private report access denied.",
    403,
  );
  const report = await db.dailyReport.findFirst({
    where: { id, ...(await reportScope(actor)) },
  });
  invariant(report, "NOT_FOUND", "Report not found.", 404);
  const links = await db.reportTask.findMany({ where: { reportId: id } });
  const tasks = await db.task.findMany({
    where: { id: { in: links.map((l) => l.taskId) }, ...visibleTasks(actor) },
    select: { id: true, title: true, status: true },
  });
  const author = await db.person.findUniqueOrThrow({
    where: { id: report.userId },
    select: { id: true, displayName: true, username: true },
  });
  const revisions = await db.reportRevision.findMany({
    where: { reportId: id },
    orderBy: { version: "desc" },
  });
  return {
    ...report,
    author,
    tasks,
    revisions,
    taskIds: links.map((l) => l.taskId),
  };
}
