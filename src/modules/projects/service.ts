import "server-only";
import { db } from "@/server/db";
import type { z } from "zod";
import type { projectQuerySchema } from "./queries";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { audit, type Tx } from "@/server/transaction";
export const visibleProjects = (actor: Actor) =>
  actor.role === "SUPER_ADMIN"
    ? {}
    : { members: { some: { userId: actor.id } } };
export async function projectFor(
  tx: Tx,
  id: string,
  actor: Actor,
  manage = false,
) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${id}::uuid FOR UPDATE`;
  const project = await tx.project.findFirst({
    where: { id, ...visibleProjects(actor) },
  });
  invariant(project, "NOT_FOUND", "Project not found.", 404);
  if (manage)
    invariant(
      actor.role === "SUPER_ADMIN" ||
        (actor.role === "TEAM_LEAD" && project.managerId === actor.id),
      "FORBIDDEN",
      "Project manager access required.",
      403,
    );
  return project;
}
export async function listProjects(actor: Actor) {
  return db.project.findMany({
    where: visibleProjects(actor),
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    include: { _count: { select: { tasks: true, members: true } } },
    take: 100,
  });
}
export async function projectDirectory(
  actor: Actor,
  query: z.infer<typeof projectQuerySchema>,
) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "HR uses attendance and leave approvals.",
    403,
  );
  const where = {
    ...visibleProjects(actor),
    ...(query.status === "active"
      ? { archivedAt: null }
      : query.status === "archived"
        ? { archivedAt: { not: null } }
        : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            {
              description: { contains: query.q, mode: "insensitive" as const },
            },
          ],
        }
      : {}),
  };
  return db.$transaction(
    async (tx) => {
      const total = await tx.project.count({ where }),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(query.page, pages);
      const items = await tx.project.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: { _count: { select: { members: true, tasks: true } } },
        take: 25,
        skip: (page - 1) * 25,
      });
      return { items, total, page, pages, filters: { ...query, page } };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export async function createProject(
  tx: Tx,
  actor: Actor,
  input: { name: string; description: string },
) {
  invariant(
    ["SUPER_ADMIN", "TEAM_LEAD"].includes(actor.role),
    "FORBIDDEN",
    "A lead or super admin must create projects.",
    403,
  );
  const p = await tx.project.create({
    data: {
      ...input,
      managerId: actor.id,
      members: { create: { userId: actor.id } },
    },
  });
  await audit(tx, actor.id, "PROJECT_CREATED", p.id);
  return p;
}
export async function addMember(
  tx: Tx,
  actor: Actor,
  projectId: string,
  userId: string,
) {
  const p = await projectFor(tx, projectId, actor, true);
  invariant(!p.archivedAt, "ARCHIVED", "Archived project is read-only.", 409);
  const user = await tx.person.findUnique({ where: { id: userId } });
  invariant(
    user?.status === "ACTIVE",
    "INVALID_MEMBER",
    "Select an active person.",
  );
  const member = await tx.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId },
    update: {},
  });
  await audit(tx, actor.id, "PROJECT_MEMBER_ADDED", projectId, { userId });
  return member;
}
