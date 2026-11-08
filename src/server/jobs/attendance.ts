import "server-only";
import { db } from "../db";
import { audit, type Tx } from "../transaction";
import { calculate, type Snapshot } from "@/modules/attendance/schemas";
import { getDay, dateValue, lockDate } from "@/modules/attendance/service";
export async function reconcilePersonAttendance(
  tx: Tx,
  userId: string,
  date: string,
  now: Date,
  context?: { runId: string; actorId: string | null },
) {
  const person = await tx.person.findUnique({ where: { id: userId } });
  if (person?.status !== "ACTIVE") return { updated: 0 };
  const assignment = await tx.scheduleAssignment.findFirst({
    where: {
      userId,
      startDate: { lte: dateValue(date) },
      OR: [{ endDate: null }, { endDate: { gte: dateValue(date) } }],
    },
  });
  if (!assignment) return { updated: 0 };
  await lockDate(tx, userId, date);
  const existed = await tx.attendanceDay.findUnique({
    where: { userId_workDate: { userId, workDate: dateValue(date) } },
  });
  const day = await getDay(tx, userId, date, now);
  if (day.corrected) return { updated: 0 };
  const approved = await tx.leaveDate.findFirst({
    where: {
      userId,
      workDate: dateValue(date),
      active: true,
      request: { status: "APPROVED" },
    },
  });
  const calculated = calculate(
    day.snapshot as Snapshot,
    day.firstIn,
    day.lastOut,
    now,
  );
  if (approved) calculated.status = "ON_LEAVE";
  if (
    existed &&
    calculated.status === day.status &&
    calculated.grossMinutes === day.grossMinutes &&
    calculated.late === day.late &&
    calculated.early === day.early
  )
    return { updated: 0 };
  await tx.attendanceDay.update({
    where: { id: day.id },
    data: { ...calculated, version: { increment: 1 } },
  });
  await audit(tx, context?.actorId ?? null, "ATTENDANCE_RECONCILED", day.id, {
    from: existed?.status ?? null,
    to: calculated.status,
    workDate: date,
    ...(context ? { runId: context.runId } : {}),
  });
  return { updated: 1 };
}
export async function reconcileAttendance(
  date: string,
  now = new Date(),
  batch?: { skip?: number; take?: number; userIds?: string[] },
) {
  const assignments = await db.scheduleAssignment.findMany({
    ...(batch ? { skip: batch.skip, take: batch.take } : {}),
    orderBy: [{ userId: "asc" }, { id: "asc" }],
    where: {
      ...(batch?.userIds ? { userId: { in: batch.userIds } } : {}),
      startDate: { lte: dateValue(date) },
      OR: [{ endDate: null }, { endDate: { gte: dateValue(date) } }],
    },
  });
  let updated = 0;
  for (const userId of new Set(assignments.map((a) => a.userId)))
    updated += (
      await db.$transaction((tx) =>
        reconcilePersonAttendance(tx, userId, date, now),
      )
    ).updated;
  return { updated };
}
