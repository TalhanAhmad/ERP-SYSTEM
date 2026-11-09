import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { audit, expected, type Tx } from "@/server/transaction";
export const preferenceSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    reportReminders: z.boolean(),
  })
  .strict();
export async function notificationPreference(actor: Actor) {
  return (
    (await db.notificationPreference.findUnique({
      where: { userId: actor.id },
    })) ?? { userId: actor.id, version: 0, reportReminders: true }
  );
}
export async function savePreference(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof preferenceSchema>,
) {
  const old = await tx.notificationPreference.findUnique({
    where: { userId: actor.id },
  });
  expected(old?.version ?? 0, input.expectedVersion);
  const item = await tx.notificationPreference.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, reportReminders: input.reportReminders },
    update: {
      reportReminders: input.reportReminders,
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, "NOTIFICATION_PREFERENCES_UPDATED", actor.id, {
    reportReminders: item.reportReminders,
  });
  return item;
}
export async function readAllNotifications(tx: Tx, actor: Actor) {
  const result = await tx.notification.updateMany({
    where: { recipientId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  await audit(tx, actor.id, "NOTIFICATIONS_READ", actor.id, {
    count: result.count,
  });
  return { count: result.count };
}
