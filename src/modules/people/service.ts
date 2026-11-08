import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import {
  roleSchema,
  profileSchema,
  peopleQuerySchema,
  accountStatusSchema,
} from "./schemas";
export {
  roleSchema,
  profileSchema,
  peopleQuerySchema,
  accountStatusSchema,
} from "./schemas";
import { env } from "@/server/env";
import type { Actor } from "@/server/context";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
const personFields = {
  id: true,
  displayName: true,
  username: true,
  email: true,
  role: true,
  employmentType: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
function requireAdmin(actor: Actor) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin access required.",
    403,
  );
}
export async function listPeople(
  actor: Actor,
  query: z.infer<typeof peopleQuerySchema>,
) {
  requireAdmin(actor);
  const where = {
    ...(query.status === "ALL" ? {} : { status: query.status }),
    ...(query.role === "ALL" ? {} : { role: query.role }),
    ...(query.q
      ? {
          OR: [
            {
              displayName: { contains: query.q, mode: "insensitive" as const },
            },
            { username: { contains: query.q, mode: "insensitive" as const } },
            { email: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  return db.$transaction(
    async (tx) => {
      const total = await tx.person.count({ where });
      const pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(query.page, pages);
      const items = await tx.person.findMany({
        where,
        select: personFields,
        orderBy: [{ username: "asc" }, { id: "asc" }],
        skip: (page - 1) * 25,
        take: 25,
      });
      return {
        items,
        total,
        page,
        pageSize: 25,
        pages,
        filters: { ...query, page },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
export async function personDetail(actor: Actor, id: string) {
  requireAdmin(actor);
  const person = await db.person.findUnique({
    where: { id },
    select: personFields,
  });
  invariant(person, "NOT_FOUND", "Person not found.", 404);
  const [identity, openAssignments, managedProjects, history] =
    await Promise.all([
      db.person.findUniqueOrThrow({
        where: { id },
        select: { authUserId: true, supabaseUserId: true },
      }),
      db.task.count({
        where: { assigneeId: id, status: { notIn: ["APPROVED", "CANCELED"] } },
      }),
      db.project.count({ where: { managerId: id, archivedAt: null } }),
      db.audit.findMany({
        where: {
          entityId: id,
          action: {
            in: [
              "PROFILE_UPDATED",
              "ROLE_CHANGED",
              "PERSON_DEACTIVATED",
              "PERSON_REACTIVATED",
            ],
          },
        },
        select: {
          id: true,
          action: true,
          actorId: true,
          changes: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
      }),
    ]);
  const authors = await db.person.findMany({
    where: {
      id: { in: history.flatMap((h) => (h.actorId ? [h.actorId] : [])) },
    },
    select: { id: true, displayName: true },
  });
  const names = new Map(authors.map((a) => [a.id, a.displayName]));
  return {
    ...person,
    openAssignments,
    managedProjects,
    canReactivate:
      person.status === "INACTIVE" &&
      Boolean(
        env.AUTH_PROVIDER === "supabase"
          ? identity.supabaseUserId
          : identity.authUserId,
      ),
    history: history.map((h) => {
      const value = z
        .object({ reason: z.string().optional() })
        .passthrough()
        .safeParse(h.changes);
      return {
        id: h.id,
        action: h.action,
        actorName: h.actorId
          ? (names.get(h.actorId) ?? "Administrator")
          : "System",
        createdAt: h.createdAt,
        reason: value.success ? value.data.reason : undefined,
      };
    }),
  };
}
export async function editProfile(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof profileSchema>,
) {
  requireAdmin(actor);
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${id}::uuid FOR UPDATE`;
  const target = await tx.person.findUnique({ where: { id } });
  invariant(target, "NOT_FOUND", "Person not found.", 404);
  expected(target.version, input.expectedVersion);
  if (target.username !== input.username) {
    invariant(
      !(await tx.person.findFirst({
        where: { id: { not: id }, username: input.username },
      })),
      "DUPLICATE",
      "This username is already in use.",
      409,
    );
    invariant(
      !(await tx.invitation.findFirst({
        where: {
          username: input.username,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      })),
      "USERNAME_RESERVED",
      "This username belongs to a pending invitation.",
      409,
    );
  }
  const before = {
      displayName: target.displayName,
      username: target.username,
      employmentType: target.employmentType,
    },
    after = {
      displayName: input.displayName,
      username: input.username,
      employmentType: input.employmentType,
    };
  if (JSON.stringify(before) === JSON.stringify(after))
    return { id, version: target.version };
  const updated = await tx.person.update({
    where: { id },
    data: { ...after, version: { increment: 1 } },
  });
  await audit(tx, actor.id, "PROFILE_UPDATED", id, { before, after });
  return { id, version: updated.version };
}
export async function reactivate(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof accountStatusSchema>,
) {
  requireAdmin(actor);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(987661)::text`;
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${id}::uuid FOR UPDATE`;
  const target = await tx.person.findUnique({ where: { id } });
  invariant(target, "NOT_FOUND", "Person not found.", 404);
  expected(target.version, input.expectedVersion);
  invariant(
    target.status === "INACTIVE",
    "ACCOUNT_STATE",
    "Only an inactive account can be reactivated.",
    409,
  );
  invariant(
    Boolean(
      env.AUTH_PROVIDER === "supabase"
        ? target.supabaseUserId
        : target.authUserId,
    ),
    "IDENTITY_NOT_LINKED",
    "This account has no linked sign-in identity. Complete account setup first.",
    409,
  );
  const updated = await tx.person.update({
    where: { id },
    data: { status: "ACTIVE", version: { increment: 1 } },
  });
  if (target.authUserId && env.AUTH_PROVIDER === "better-auth")
    await tx.session.deleteMany({ where: { userId: target.authUserId } });
  await audit(tx, actor.id, "PERSON_REACTIVATED", id, {
    reason: input.reason ?? "Administrator reactivation",
  });
  return { id, status: updated.status, version: updated.version };
}
export async function changeRole(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof roleSchema>,
) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Only super admins can change roles.",
    403,
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(987661)::text`;
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${id}::uuid FOR UPDATE`;
  const target = await tx.person.findUnique({ where: { id } });
  invariant(target, "NOT_FOUND", "Person not found.", 404);
  expected(target.version, input.expectedVersion);
  if (
    target.role === "SUPER_ADMIN" &&
    target.status === "ACTIVE" &&
    input.role !== "SUPER_ADMIN"
  )
    invariant(
      (await tx.person.count({
        where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      })) > 1,
      "LAST_ADMIN",
      "At least one active super admin is required.",
      409,
    );
  invariant(
    actor.id !== id,
    "SELF_ROLE_CHANGE",
    "Ask another super admin to change your role.",
    403,
  );
  if (target.role === input.role)
    return { id: target.id, role: target.role, version: target.version };
  const updated = await tx.person.update({
    where: { id },
    data: { role: input.role, version: { increment: 1 } },
  });
  if (target.authUserId && env.AUTH_PROVIDER === "better-auth")
    await tx.session.deleteMany({ where: { userId: target.authUserId } });
  await audit(tx, actor.id, "ROLE_CHANGED", id, {
    from: target.role,
    to: input.role,
    reason: input.reason ?? "Administrator role change",
  });
  return { id: updated.id, role: updated.role, version: updated.version };
}
export async function deactivate(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof accountStatusSchema>,
) {
  invariant(
    ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role),
    "FORBIDDEN",
    "HR or super admin access required.",
    403,
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(987661)::text`;
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${id}::uuid FOR UPDATE`;
  const target = await tx.person.findUnique({ where: { id } });
  invariant(target, "NOT_FOUND", "Person not found.", 404);
  expected(target.version, input.expectedVersion);
  invariant(
    actor.role === "SUPER_ADMIN" || target.role === "MEMBER",
    "FORBIDDEN",
    "HR can deactivate ordinary members only.",
    403,
  );
  if (target.role === "SUPER_ADMIN" && target.status === "ACTIVE")
    invariant(
      (await tx.person.count({
        where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      })) > 1,
      "LAST_ADMIN",
      "At least one active super admin is required.",
      409,
    );
  invariant(
    actor.id !== id,
    "SELF_DEACTIVATION",
    "Ask another administrator to deactivate your account.",
    403,
  );
  invariant(
    target.status !== "INACTIVE",
    "ACCOUNT_STATE",
    "This account is already inactive.",
    409,
  );
  const updated = await tx.person.update({
    where: { id },
    data: { status: "INACTIVE", version: { increment: 1 } },
  });
  if (target.authUserId && env.AUTH_PROVIDER === "better-auth")
    await tx.session.deleteMany({ where: { userId: target.authUserId } });
  const assigned = await tx.task.count({
    where: { assigneeId: id, status: { notIn: ["APPROVED", "CANCELED"] } },
  });
  await audit(tx, actor.id, "PERSON_DEACTIVATED", id, {
    openAssignments: assigned,
    reason: input.reason ?? "Administrator deactivation",
  });
  return {
    id: updated.id,
    status: updated.status,
    version: updated.version,
    openAssignments: assigned,
  };
}
