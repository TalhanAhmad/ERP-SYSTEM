import "server-only";
import { db } from "../db";
import { calculate, type Snapshot } from "@/modules/attendance/schemas";
import { getDay, dateValue } from "@/modules/attendance/service";
export async function reconcileAttendance(date: string, now = new Date()) {
  const assignments = await db.scheduleAssignment.findMany({
    where: {
      startDate: { lte: dateValue(date) },
      OR: [{ endDate: null }, { endDate: { gte: dateValue(date) } }],
    },
  });
  let updated = 0;
  for (const assignment of assignments) {
    const person = await db.person.findUnique({
      where: { id: assignment.userId },
    });
    if (person?.status !== "ACTIVE") continue;
    await db.$transaction(async (tx) => {
      const day = await getDay(tx, person.id, date, now);
      if (day.corrected) return;
      const approved = await tx.leaveDate.findFirst({
        where: {
          userId: person.id,
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
        calculated.status === day.status &&
        calculated.grossMinutes === day.grossMinutes
      )
        return;
      await tx.attendanceDay.update({
        where: { id: day.id },
        data: { ...calculated, version: { increment: 1 } },
      });
      updated++;
    });
  }
  return { updated };
}
