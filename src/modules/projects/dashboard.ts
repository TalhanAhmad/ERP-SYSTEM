import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { visibleProjects } from "./service";
import { visibleTasks } from "@/modules/tasks/service";
export async function dashboard(actor: Actor) {
  const [projects, openTasks, approved, awaitingReview] = await Promise.all([
    db.project.count({
      where: { ...visibleProjects(actor), archivedAt: null },
    }),
    db.task.count({
      where: {
        ...visibleTasks(actor),
        status: { notIn: ["APPROVED", "CANCELED"] },
      },
    }),
    db.task.count({ where: { ...visibleTasks(actor), status: "APPROVED" } }),
    db.task.count({
      where: {
        ...visibleTasks(actor),
        status: "IN_REVIEW",
        ...(actor.role === "SUPER_ADMIN" ? {} : { reviewerId: actor.id }),
      },
    }),
  ]);
  return { projects, openTasks, approved, awaitingReview };
}
