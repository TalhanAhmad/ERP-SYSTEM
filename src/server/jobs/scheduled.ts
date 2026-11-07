import "server-only";
import { db } from "../db";
import { workDate } from "@/lib/dates";
import { reconcileAttendance } from "./attendance";
import { processOutbox } from "./outbox";
import { emailSender } from "./email";
// Bounded passes resume through durable email leases and deterministic date slices.
// Configure a recurring scheduler; Vercel does not run a permanent Node worker.
export async function scheduledPass(
  send: Parameters<typeof processOutbox>[0] = emailSender(),
) {
  const now = new Date();
  const day = workDate(now);
  const active = await db.person.count({ where: { status: "ACTIVE" } });
  const slice =
    Math.floor(now.getTime() / 60000) % Math.max(1, Math.ceil(active / 20));
  const users = await db.person.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
    skip: slice * 20,
    take: 20,
  });
  const mail = await processOutbox(send, 1);
  let updated = 0;
  for (const date of [workDate(new Date(now.getTime() - 86400000)), day])
    updated += (
      await reconcileAttendance(date, now, {
        userIds: users.map((user) => user.id),
      })
    ).updated;
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.idempotency.deleteMany({ where: { expiresAt: { lt: now } } });
  return { mailClaimed: mail.claimed, attendanceUpdated: updated, slice };
}
