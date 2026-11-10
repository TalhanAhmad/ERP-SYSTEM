import "server-only";
import { reportStatusRows } from "@/modules/reports/status";
import { workDate } from "@/lib/dates";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { visibleProjects } from "./service";
import { assignmentWhere } from "@/modules/tasks/service";
export async function dashboard(actor: Actor) {
  const [projects, openTasks, approved, awaitingReview] = await Promise.all([
    db.project.count({
      where: { ...visibleProjects(actor), archivedAt: null },
    }),
    db.task.count({ where: assignmentWhere(actor, "open") }),
    db.task.count({ where: assignmentWhere(actor, "approved") }),
    db.task.count({ where: assignmentWhere(actor, "review") }),
  ]);
  return { projects, openTasks, approved, awaitingReview };
}

export async function dashboardFollowUp(actor: Actor) {
  const [reports, overdue, jobFailures, maintenanceFailures, emailFailures] =
    await Promise.all([
      reportStatusRows(actor, workDate()),
      db.task.count({
        where: {
          AND: [assignmentWhere(actor, "open"), { dueAt: { lt: new Date() } }],
        },
      }),
      actor.role === "SUPER_ADMIN"
        ? db.jobRun.count({ where: { status: "FAILED" } })
        : 0,
      actor.role === "SUPER_ADMIN"
        ? db.maintenanceRun.count({ where: { status: "FAILED" } })
        : 0,
      actor.role === "SUPER_ADMIN"
        ? db.outbox.count({
            where: {
              deliveredAt: null,
              canceledAt: null,
              attempts: { gte: 5 },
            },
          })
        : 0,
    ]);
  return {
    missingReports: reports.filter((r) => r.status === "missing").length,
    overdue,
    failures: jobFailures + maintenanceFailures + emailFailures,
  };
}
