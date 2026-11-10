import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import type { Prisma } from "@/generated/prisma/client";
export const activityQuery = z
  .object({
    q: z.string().trim().max(100).default(""),
    status: z.enum(["all", "unread", "read"]).default("all"),
    action: z
      .string()
      .regex(/^[A-Z_]{0,80}$/)
      .default(""),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export async function activityList(
  actor: Actor,
  kind: "notifications" | "audit",
  query: z.infer<typeof activityQuery>,
) {
  invariant(
    kind !== "audit" || actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin access required.",
    403,
  );
  return db.$transaction(
    async (tx) => {
      const where: Prisma.NotificationWhereInput = {
        recipientId: actor.id,
        ...(query.status === "read"
          ? { readAt: { not: null } }
          : query.status === "unread"
            ? { readAt: null }
            : {}),
        ...(query.q
          ? { title: { contains: query.q, mode: "insensitive" } }
          : {}),
      };
      const auditWhere: Prisma.AuditWhereInput = {
        ...(query.action ? { action: query.action } : {}),
        ...(query.q
          ? {
              OR: [
                { action: { contains: query.q, mode: "insensitive" } },
                { entityId: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const total =
          kind === "notifications"
            ? await tx.notification.count({ where })
            : await tx.audit.count({ where: auditWhere }),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(query.page, pages);
      const items =
        kind === "notifications"
          ? await tx.notification.findMany({
              where,
              orderBy: [{ createdAt: query.order }, { id: "asc" }],
              take: 25,
              skip: (page - 1) * 25,
              select: {
                id: true,
                title: true,
                target: true,
                readAt: true,
                createdAt: true,
              },
            })
          : await tx.audit.findMany({
              where: auditWhere,
              orderBy: [{ createdAt: query.order }, { id: "asc" }],
              take: 25,
              skip: (page - 1) * 25,
              select: {
                id: true,
                action: true,
                entityId: true,
                createdAt: true,
              },
            });
      return { items, total, pages, page, filters: query };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
