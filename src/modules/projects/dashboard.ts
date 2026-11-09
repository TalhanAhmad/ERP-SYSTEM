import "server-only";
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
