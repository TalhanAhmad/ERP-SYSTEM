import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { hr } from "./service";
export async function attendanceDetail(actor: Actor, id: string) {
  const day = await db.attendanceDay.findFirst({
    where: { id, ...(hr(actor) ? {} : { userId: actor.id }) },
  });
  invariant(day, "NOT_FOUND", "Attendance record not found.", 404);
  const [person, events, corrections] = await Promise.all([
    db.person.findUniqueOrThrow({
      where: { id: day.userId },
      select: { id: true, displayName: true, username: true, status: true },
    }),
    db.attendanceEvent.findMany({
      where: { dayId: id },
      orderBy: { occurredAt: "asc" },
    }),
    actor.role === "SUPER_ADMIN" || actor.id === day.userId
      ? db.attendanceCorrection.findMany({
          where: { dayId: id },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);
  return { ...day, person, events, corrections };
}
