import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { dateValue } from "./service";
import { workDate } from "@/lib/dates";
const version = z.number().int().positive();
export const replaceScheduleSchema = z
  .object({
    expectedVersion: version,
    policyId: z.uuid(),
    effectiveDate: z.iso.date(),
    endDate: z.iso.date().optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.effectiveDate, {
    message: "End date must follow the effective date.",
    path: ["endDate"],
  });
export const holidaySchema = z
  .object({ date: z.iso.date(), name: z.string().trim().min(1).max(120) })
  .strict();
export const holidayEditSchema = holidaySchema.extend({
  expectedVersion: version,
});
export const versionSchema = z.object({ expectedVersion: version }).strict();
function root(actor: Actor) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin access required.",
    403,
  );
}
export async function calendarData(actor: Actor) {
  root(actor);
  const [assignments, holidays] = await Promise.all([
    db.scheduleAssignment.findMany({
      orderBy: [{ startDate: "desc" }, { id: "asc" }],
    }),
    db.holiday.findMany({ orderBy: { date: "desc" } }),
  ]);
  const [people, policies] = await Promise.all([
    db.person.findMany({
      select: {
        id: true,
        displayName: true,
        username: true,
        role: true,
        status: true,
      },
      orderBy: { displayName: "asc" },
    }),
    db.schedulePolicy.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  return { assignments, holidays, people, policies };
}
export async function replaceSchedule(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof replaceScheduleSchema>,
) {
  root(actor);
  const first = await tx.scheduleAssignment.findUnique({ where: { id } });
  invariant(first, "NOT_FOUND", "Schedule assignment not found.", 404);
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${first.userId}::uuid FOR UPDATE`;
  const old = await tx.scheduleAssignment.findUniqueOrThrow({ where: { id } });
  expected(old.version, input.expectedVersion);
  const person = await tx.person.findUniqueOrThrow({
    where: { id: old.userId },
  });
  invariant(
    person.status === "ACTIVE" && person.role !== "SUPER_ADMIN",
    "INVALID_PERSON",
    "Select active staff with personal attendance.",
  );
  invariant(
    input.effectiveDate >= workDate(),
    "HISTORICAL_SCHEDULE",
    "Changes must apply today or later.",
  );
  const start = dateValue(input.effectiveDate),
    end = input.endDate ? dateValue(input.endDate) : old.endDate;
  invariant(
    start >= old.startDate && (!old.endDate || start <= old.endDate),
    "OUTSIDE_ASSIGNMENT",
    "The effective date must be within this assignment.",
  );
  invariant(
    !end || end >= start,
    "INVALID_RANGE",
    "End date must follow the effective date.",
  );
  invariant(
    await tx.schedulePolicy.findUnique({ where: { id: input.policyId } }),
    "NOT_FOUND",
    "Schedule policy not found.",
    404,
  );
  const range = { gte: start, ...(old.endDate ? { lte: old.endDate } : {}) };
  invariant(
    !(await tx.attendanceDay.count({
      where: { userId: old.userId, workDate: range },
    })) &&
      !(await tx.leaveDate.count({
        where: { userId: old.userId, workDate: range, active: true },
      })),
    "RECORDED_CALENDAR",
    "Recorded attendance or reserved leave exists in the affected range. Choose a later effective date or resolve leave first.",
    409,
  );
  invariant(
    !(await tx.scheduleAssignment.count({
      where: {
        id: { not: id },
        userId: old.userId,
        ...(end ? { startDate: { lte: end } } : {}),
        OR: [{ endDate: null }, { endDate: { gte: start } }],
      },
    })),
    "SCHEDULE_OVERLAP",
    "The replacement overlaps another assignment.",
    409,
  );
  let record;
  if (start.getTime() === old.startDate.getTime())
    record = await tx.scheduleAssignment.update({
      where: { id },
      data: {
        policyId: input.policyId,
        endDate: end,
        version: { increment: 1 },
      },
    });
  else {
    await tx.scheduleAssignment.update({
      where: { id },
      data: {
        endDate: new Date(start.getTime() - 86400000),
        version: { increment: 1 },
      },
    });
    record = await tx.scheduleAssignment.create({
      data: {
        userId: old.userId,
        policyId: input.policyId,
        startDate: start,
        endDate: end,
      },
    });
  }
  await audit(tx, actor.id, "SCHEDULE_REPLACED", id, {
    reason: input.reason,
    replacementId: record.id,
    effectiveDate: input.effectiveDate,
    before: {
      policyId: old.policyId,
      startDate: old.startDate.toISOString(),
      endDate: old.endDate?.toISOString() ?? null,
    },
    after: {
      policyId: record.policyId,
      startDate: record.startDate.toISOString(),
      endDate: record.endDate?.toISOString() ?? null,
    },
  });
  return record;
}
async function holidayLock(tx: Tx, date: string) {
  invariant(
    date >= workDate(),
    "HISTORICAL_HOLIDAY",
    "Holiday changes must apply today or later.",
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('company-calendar',0))::text`;
  const day = dateValue(date);
  invariant(
    !(await tx.attendanceDay.count({ where: { workDate: day } })) &&
      !(await tx.leaveDate.count({ where: { workDate: day, active: true } })),
    "RECORDED_CALENDAR",
    "Attendance or reserved leave already exists on this date.",
    409,
  );
}
export async function saveHoliday(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof holidaySchema>,
  id?: string,
  expectedVersion?: number,
) {
  root(actor);
  const old = id ? await tx.holiday.findUnique({ where: { id } }) : null;
  if (id) {
    invariant(old, "NOT_FOUND", "Holiday not found.", 404);
    expected(old.version, expectedVersion!);
  }
  if (!old || old.date.toISOString().slice(0, 10) !== input.date) {
    if (old) await holidayLock(tx, old.date.toISOString().slice(0, 10));
    await holidayLock(tx, input.date);
  }
  const item = old
    ? await tx.holiday.update({
        where: { id },
        data: {
          date: dateValue(input.date),
          name: input.name,
          version: { increment: 1 },
        },
      })
    : await tx.holiday.create({
        data: { date: dateValue(input.date), name: input.name },
      });
  await audit(
    tx,
    actor.id,
    old ? "HOLIDAY_UPDATED" : "HOLIDAY_CREATED",
    item.id,
    { date: input.date, name: input.name },
  );
  return item;
}
export async function removeHoliday(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof versionSchema>,
) {
  root(actor);
  const old = await tx.holiday.findUnique({ where: { id } });
  invariant(old, "NOT_FOUND", "Holiday not found.", 404);
  expected(old.version, input.expectedVersion);
  await holidayLock(tx, old.date.toISOString().slice(0, 10));
  await tx.holiday.delete({ where: { id } });
  await audit(tx, actor.id, "HOLIDAY_REMOVED", id, {
    date: old.date.toISOString().slice(0, 10),
    name: old.name,
  });
  return { id, removed: true };
}
