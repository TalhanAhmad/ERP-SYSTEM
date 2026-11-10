import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { workDate } from "@/lib/dates";
import { independent } from "@/modules/tasks/policy";
import {
  policySchema,
  assignmentSchema,
  leaveSchema,
  correctionSchema,
  calculate,
  type Snapshot,
} from "./schemas";
export const hr = (actor: Actor) =>
  ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role);
function requireHr(actor: Actor) {
  invariant(hr(actor), "FORBIDDEN", "HR or super admin access required.", 403);
}
export const dateValue = (value: string) => new Date(`${value}T00:00:00Z`);
export async function lockDate(tx: Tx, userId: string, date: string) {
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${date}`},0))::text`;
}
export async function snapshotFor(
  tx: Tx,
  userId: string,
  date: string,
): Promise<Snapshot> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('company-calendar',0))::text`;
  const day = dateValue(date);
  const assignment = await tx.scheduleAssignment.findFirst({
    where: {
      userId,
      startDate: { lte: day },
      OR: [{ endDate: null }, { endDate: { gte: day } }],
    },
    orderBy: { startDate: "desc" },
  });
  invariant(
    assignment,
    "NO_SCHEDULE",
    "No schedule is assigned for this date.",
    409,
  );
  const policy = await tx.schedulePolicy.findUniqueOrThrow({
    where: { id: assignment.policyId },
  });
  const holiday = await tx.holiday.findUnique({ where: { date: day } });
  return {
    start: `${date}T${policy.localStart}:00+05:00`,
    end: `${date}T${policy.localEnd}:00+05:00`,
    policyId: policy.id,
    graceMinutes: policy.graceMinutes,
    closingBufferMinutes: policy.closingBufferMinutes,
    kind: holiday
      ? "HOLIDAY"
      : (policy.weekdays as number[]).includes(day.getUTCDay())
        ? "WORKDAY"
        : "OFF_DAY",
  };
}
export async function getDay(
  tx: Tx,
  userId: string,
  date: string,
  now = new Date(),
) {
  await lockDate(tx, userId, date);
  const existing = await tx.attendanceDay.findUnique({
    where: { userId_workDate: { userId, workDate: dateValue(date) } },
  });
  if (existing) return existing;
  const snapshot = await snapshotFor(tx, userId, date);
  return tx.attendanceDay.create({
    data: {
      userId,
      workDate: dateValue(date),
      snapshot,
      ...calculate(snapshot, null, null, now),
    },
  });
}
export async function createPolicy(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof policySchema>,
) {
  requireHr(actor);
  const record = await tx.schedulePolicy.create({ data: input });
  await audit(tx, actor.id, "SCHEDULE_CREATED", record.id);
  return record;
}
export async function assignSchedule(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof assignmentSchema>,
) {
  requireHr(actor);
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${input.userId}::uuid FOR UPDATE`;
  const person = await tx.person.findFirst({
    where: { id: input.userId, status: "ACTIVE" },
  });
  invariant(person, "NOT_FOUND", "Active person not found.", 404);
  invariant(
    person.role !== "SUPER_ADMIN",
    "SUPER_ADMIN_SCHEDULE",
    "Super Admin accounts have view-only attendance and do not need a schedule.",
    422,
  );
  invariant(
    await tx.schedulePolicy.findUnique({ where: { id: input.policyId } }),
    "NOT_FOUND",
    "Schedule not found.",
    404,
  );
  const start = dateValue(input.startDate),
    end = input.endDate ? dateValue(input.endDate) : null;
  invariant(
    input.startDate >= workDate(),
    "HISTORICAL_SCHEDULE",
    "Schedule assignment must be prospective.",
  );
  const overlap = await tx.scheduleAssignment.findFirst({
    where: {
      userId: input.userId,
      ...(end ? { startDate: { lte: end } } : {}),
      OR: [{ endDate: null }, { endDate: { gte: start } }],
    },
  });
  invariant(
    !overlap,
    "SCHEDULE_OVERLAP",
    "Schedule assignments cannot overlap.",
    409,
  );
  const record = await tx.scheduleAssignment.create({
    data: { ...input, startDate: start, endDate: end },
  });
  await audit(tx, actor.id, "SCHEDULE_ASSIGNED", record.id, {
    userId: input.userId,
  });
  return record;
}
export async function check(
  tx: Tx,
  actor: Actor,
  kind: "IN" | "OUT",
  now = new Date(),
) {
  invariant(
    actor.role !== "SUPER_ADMIN",
    "ATTENDANCE_VIEW_ONLY",
    "Super Admin has view-only attendance access.",
    403,
  );
  const date = workDate(now);
  const day = await getDay(tx, actor.id, date, now);
  const snapshot = day.snapshot as Snapshot;
  invariant(
    snapshot.kind === "WORKDAY",
    "NON_WORKING_DAY",
    "Check-in/out is unavailable on holidays and off-days.",
    409,
  );
  const leave = await tx.leaveDate.findFirst({
    where: {
      userId: actor.id,
      workDate: dateValue(date),
      active: true,
      request: { status: "APPROVED" },
    },
  });
  invariant(
    !leave,
    "ON_LEAVE",
    "Approved leave blocks attendance events.",
    409,
  );
  if (kind === "IN")
    invariant(
      !day.firstIn,
      "ALREADY_CHECKED_IN",
      "You have already checked in.",
      409,
    );
  else
    invariant(
      day.firstIn && !day.lastOut && now > day.firstIn,
      "INVALID_CHECKOUT",
      "Check in first; check-out must follow check-in.",
      409,
    );
  invariant(
    !day.corrected,
    "CORRECTED_DAY",
    "This day has an approved correction; request HR review.",
    409,
  );
  await tx.attendanceEvent.create({
    data: { dayId: day.id, userId: actor.id, kind, occurredAt: now },
  });
  const firstIn = kind === "IN" ? now : day.firstIn,
    lastOut = kind === "OUT" ? now : null;
  const updated = await tx.attendanceDay.update({
    where: { id: day.id },
    data: {
      firstIn,
      lastOut,
      ...calculate(snapshot, firstIn, lastOut, now),
      version: { increment: 1 },
    },
  });
  await audit(
    tx,
    actor.id,
    kind === "IN" ? "CHECKED_IN" : "CHECKED_OUT",
    day.id,
  );
  return updated;
}
export async function requestLeave(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof leaveSchema>,
) {
  const dates: string[] = [];
  for (
    let day = dateValue(input.startDate);
    day <= dateValue(input.endDate);
    day = new Date(day.getTime() + 86400000)
  ) {
    const date = day.toISOString().slice(0, 10);
    const snapshot = await snapshotFor(tx, actor.id, date);
    if (snapshot.kind === "WORKDAY") dates.push(date);
  }
  invariant(
    dates.length,
    "NO_WORKING_DATES",
    "This range has no scheduled working dates.",
  );
  for (const date of dates) {
    await lockDate(tx, actor.id, date);
    invariant(
      !(await tx.leaveDate.findFirst({
        where: { userId: actor.id, workDate: dateValue(date), active: true },
      })),
      "LEAVE_OVERLAP",
      "A pending or approved request overlaps this date.",
      409,
    );
  }
  const record = await tx.leaveRequest.create({
    data: {
      userId: actor.id,
      startDate: dateValue(input.startDate),
      endDate: dateValue(input.endDate),
      type: input.type,
      privateNote: input.privateNote,
      dates: {
        create: dates.map((date) => ({
          userId: actor.id,
          workDate: dateValue(date),
        })),
      },
    },
  });
  await audit(tx, actor.id, "LEAVE_REQUESTED", record.id);
  return record;
}
async function decisionNotification(
  tx: Tx,
  userId: string,
  id: string,
  title: string,
  target: string,
) {
  await tx.notification.create({
    data: { recipientId: userId, eventKey: `decision:${id}`, title, target },
  });
}
export async function decideLeave(
  tx: Tx,
  actor: Actor,
  id: string,
  input: { expectedVersion: number; action: "approve" | "reject" | "cancel" },
) {
  await tx.$queryRaw`SELECT id FROM "LeaveRequest" WHERE id=${id}::uuid FOR UPDATE`;
  const record = await tx.leaveRequest.findFirst({
    where: { id, ...(hr(actor) ? {} : { userId: actor.id }) },
    include: { dates: { orderBy: { workDate: "asc" } } },
  });
  invariant(record, "NOT_FOUND", "Leave request not found.", 404);
  expected(record.version, input.expectedVersion);
  if (input.action === "cancel" && record.status === "PENDING")
    invariant(
      record.userId === actor.id || hr(actor),
      "FORBIDDEN",
      "Cannot cancel this request.",
      403,
    );
  else {
    requireHr(actor);
    independent(actor.id, record.userId);
  }
  invariant(
    record.status === "PENDING" ||
      (record.status === "APPROVED" && input.action === "cancel"),
    "INVALID_TRANSITION",
    "This leave request is already resolved.",
    409,
  );
  const status =
    input.action === "approve"
      ? "APPROVED"
      : input.action === "reject"
        ? "REJECTED"
        : "CANCELED";
  for (const d of record.dates) {
    const date = d.workDate.toISOString().slice(0, 10);
    const day = await getDay(tx, record.userId, date);
    if (input.action === "approve")
      invariant(
        !(await tx.attendanceEvent.count({ where: { dayId: day.id } })) &&
          !day.corrected,
        "ATTENDANCE_CONFLICT",
        "Attendance or an approved correction exists; resolve the conflict first.",
        409,
      );
    if (input.action === "approve")
      await tx.attendanceDay.update({
        where: { id: day.id },
        data: { status: "ON_LEAVE", version: { increment: 1 } },
      });
    if (record.status === "APPROVED" && input.action === "cancel")
      await tx.attendanceDay.update({
        where: { id: day.id },
        data: {
          ...calculate(
            day.snapshot as Snapshot,
            day.firstIn,
            day.lastOut,
            new Date(),
            day.corrected,
          ),
          version: { increment: 1 },
        },
      });
  }
  if (status !== "APPROVED")
    await tx.leaveDate.updateMany({
      where: { requestId: id },
      data: { active: false },
    });
  const updated = await tx.leaveRequest.update({
    where: { id },
    data: {
      status,
      reviewerId: actor.id,
      reviewedAt: new Date(),
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, `LEAVE_${status}`, id);
  await decisionNotification(
    tx,
    record.userId,
    `${id}:${updated.version}`,
    "Your leave request was updated",
    "/leave",
  );
  return updated;
}
export async function requestCorrection(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof correctionSchema>,
) {
  const day = await tx.attendanceDay.findFirst({
    where: { id: input.attendanceDayId, userId: actor.id },
  });
  invariant(day, "NOT_FOUND", "Attendance day not found.", 404);
  await lockDate(tx, actor.id, day.workDate.toISOString().slice(0, 10));
  expected(day.version, input.expectedDayVersion);
  const snapshot = day.snapshot as Snapshot;
  const proposedIn = new Date(input.proposedIn),
    proposedOut = new Date(input.proposedOut);
  invariant(
    snapshot.kind === "WORKDAY" &&
      workDate(proposedIn) === day.workDate.toISOString().slice(0, 10) &&
      workDate(proposedOut) === workDate(proposedIn) &&
      proposedIn >= new Date(snapshot.start) &&
      proposedOut <= new Date(snapshot.end),
    "INVALID_CORRECTION",
    "Times must fit the assigned day shift.",
  );
  const record = await tx.attendanceCorrection.create({
    data: {
      dayId: day.id,
      requestedBy: actor.id,
      proposedIn,
      proposedOut,
      reason: input.reason,
      expectedDayVersion: input.expectedDayVersion,
    },
  });
  await audit(tx, actor.id, "CORRECTION_REQUESTED", record.id);
  return record;
}
export async function decideCorrection(
  tx: Tx,
  actor: Actor,
  id: string,
  input: {
    expectedVersion: number;
    action: "approve" | "reject";
    reason?: string;
  },
) {
  requireHr(actor);
  if (input.action === "reject")
    invariant(
      input.reason?.trim(),
      "REASON_REQUIRED",
      "Explain why this correction is rejected.",
    );
  await tx.$queryRaw`SELECT id FROM "AttendanceCorrection" WHERE id=${id}::uuid FOR UPDATE`;
  const record = await tx.attendanceCorrection.findUnique({ where: { id } });
  invariant(record, "NOT_FOUND", "Correction not found.", 404);
  independent(actor.id, record.requestedBy);
  expected(record.version, input.expectedVersion);
  invariant(
    record.status === "PENDING",
    "INVALID_TRANSITION",
    "Request already resolved.",
    409,
  );
  const before = await tx.attendanceDay.findUniqueOrThrow({
    where: { id: record.dayId },
  });
  await lockDate(tx, before.userId, before.workDate.toISOString().slice(0, 10));
  const day = await tx.attendanceDay.findUniqueOrThrow({
    where: { id: record.dayId },
  });
  if (input.action === "approve") {
    expected(day.version, record.expectedDayVersion);
    invariant(
      day.status !== "ON_LEAVE",
      "ON_LEAVE",
      "Cancel approved leave before correcting attendance.",
      409,
    );
    await tx.attendanceDay.update({
      where: { id: day.id },
      data: {
        firstIn: record.proposedIn,
        lastOut: record.proposedOut,
        ...calculate(
          day.snapshot as Snapshot,
          record.proposedIn,
          record.proposedOut,
          new Date(),
          true,
        ),
        version: { increment: 1 },
      },
    });
  }
  const status = input.action === "approve" ? "APPROVED" : "REJECTED";
  const updated = await tx.attendanceCorrection.update({
    where: { id },
    data: {
      status,
      reviewerId: actor.id,
      reviewedAt: new Date(),
      decisionReason: input.reason ?? null,
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, `CORRECTION_${status}`, id, {
    dayId: day.id,
    before: {
      firstIn: day.firstIn?.toISOString() ?? null,
      lastOut: day.lastOut?.toISOString() ?? null,
    },
    ...(input.action === "approve"
      ? {
          after: {
            firstIn: record.proposedIn.toISOString(),
            lastOut: record.proposedOut.toISOString(),
          },
        }
      : {}),
  });
  await decisionNotification(
    tx,
    record.requestedBy,
    `${id}:${updated.version}`,
    "Your attendance correction was reviewed",
    "/corrections",
  );
  return updated;
}
export async function attendanceList(actor: Actor) {
  return db.attendanceDay.findMany({
    where: hr(actor) ? {} : { userId: actor.id },
    orderBy: [{ workDate: "desc" }, { id: "asc" }],
    take: 100,
  });
}
