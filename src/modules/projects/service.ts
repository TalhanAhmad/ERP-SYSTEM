import "server-only";
import { db } from "@/server/db";
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
      actor.role === "SUPER_ADMIN" || project.managerId === actor.id,
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
