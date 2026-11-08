import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { audit, expected, type Tx } from "@/server/transaction";
export const announcementSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
    expectedId: z.uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.expectedId) === Boolean(v.expectedVersion));
export const deleteAnnouncementSchema = z
  .object({
    expectedId: z.uuid(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
const mutationFields = { id: true, version: true, expiresAt: true } as const;
const fields = {
  id: true,
  title: true,
  body: true,
  version: true,
  publishedAt: true,
  expiresAt: true,
} as const;
export async function cleanupExpiredAnnouncements(tx: Tx = db) {
  // DELETE rechecks its predicate after a competing edit's row lock is released.
  // No expired content is retained in notification bodies or audit snapshots.
  return (
    await tx.announcement.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    })
  ).count;
}
export async function activeAnnouncement() {
  await cleanupExpiredAnnouncements();
  const item = await db.announcement.findFirst({
    where: { expiresAt: { gt: new Date() } },
    select: fields,
  });
  return item
    ? {
        ...item,
        publishedAt: item.publishedAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
      }
    : null;
}
function admin(actor: Actor) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Only Super Admin can manage announcements.",
    403,
  );
}
export async function saveAnnouncement(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof announcementSchema>,
) {
  admin(actor);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(271828)::text`;
  await tx.$queryRaw`SELECT id FROM "Announcement" WHERE slot='workspace' FOR UPDATE`;
  const current = await tx.announcement.findUnique({
    where: { slot: "workspace" },
  });
  const now = new Date();
  if (input.expectedId) {
    invariant(
      current?.id === input.expectedId && current.expiresAt > now,
      "ANNOUNCEMENT_CHANGED",
      "This announcement expired or changed. Reload before trying again.",
      409,
    );
    expected(current.version, input.expectedVersion!);
    const updated = await tx.announcement.update({
      where: { id: current.id },
      data: {
        title: input.title,
        body: input.body,
        updatedBy: actor.id,
        version: { increment: 1 },
        publishedAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
      },
      select: mutationFields,
    });
    await audit(tx, actor.id, "ANNOUNCEMENT_UPDATED", current.id, {
      version: updated.version,
    });
    return updated;
  }
  invariant(
    !current || current.expiresAt <= now,
    "ANNOUNCEMENT_EXISTS",
    "An announcement is already active. Reload to edit it.",
    409,
  );
  if (current) await tx.announcement.delete({ where: { id: current.id } });
  const item = await tx.announcement.create({
    data: {
      title: input.title,
      body: input.body,
      publishedBy: actor.id,
      updatedBy: actor.id,
      publishedAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
    },
    select: mutationFields,
  });
  await audit(tx, actor.id, "ANNOUNCEMENT_PUBLISHED", item.id);
  return item;
}
export async function deleteAnnouncement(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof deleteAnnouncementSchema>,
) {
  admin(actor);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(271828)::text`;
  await tx.$queryRaw`SELECT id FROM "Announcement" WHERE slot='workspace' FOR UPDATE`;
  const current = await tx.announcement.findUnique({
    where: { slot: "workspace" },
  });
  invariant(
    current?.id === input.expectedId,
    "ANNOUNCEMENT_CHANGED",
    "This announcement expired or changed. Reload before trying again.",
    409,
  );
  expected(current.version, input.expectedVersion);
  await tx.announcement.delete({ where: { id: current.id } });
  await audit(tx, actor.id, "ANNOUNCEMENT_DELETED", current.id);
  return { id: current.id };
}
