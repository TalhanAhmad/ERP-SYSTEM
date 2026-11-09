import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit, expected, type Tx } from "../transaction";
import type { Actor } from "../context";
import { invariant, AppError } from "../errors";
import { workDate } from "@/lib/dates";
import { dateValue } from "@/modules/attendance/service";
import { reconcilePersonAttendance } from "./attendance";
import { emailStatus } from "@/lib/email-config";
import type { Prisma } from "@/generated/prisma/client";
export const queueJobSchema = z
  .object({ workDate: z.iso.date(), reason: z.string().trim().min(1).max(500) })
  .strict();
export const runJobSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
type Source = "ADMIN" | "CRON" | "CLI";
export function requireOperator(actor: Actor) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super admin access required.",
    403,
  );
}
const safeJob = {
  id: true,
  kind: true,
  total: true,
  workDate: true,
  reason: true,
  source: true,
  cursor: true,
  updatedCount: true,
  status: true,
  errorCode: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  finishedAt: true,
  leaseUntil: true,
  attempts: {
    orderBy: [{ startedAt: "desc" as const }, { id: "desc" as const }],
    take: 5,
    select: {
      id: true,
      source: true,
      reason: true,
      status: true,
      startCursor: true,
      endCursor: true,
      errorCode: true,
      startedAt: true,
      finishedAt: true,
    },
  },
  _count: { select: { attempts: true } },
} satisfies Prisma.JobRunSelect;
type SelectedJob = import("@/generated/prisma/client").Prisma.JobRunGetPayload<{
  select: typeof safeJob;
}>;
function presentJob(row: SelectedJob) {
  const { leaseUntil, _count, ...rest } = row;
  return {
    ...rest,
    processed: row.cursor,
    attemptCount: _count.attempts,
    status:
      row.status === "RUNNING" && leaseUntil && leaseUntil <= new Date()
        ? "INTERRUPTED"
        : row.status,
  };
}
async function jobDto(id: string) {
  return presentJob(
    await db.jobRun.findUniqueOrThrow({ where: { id }, select: safeJob }),
  );
}
export async function createAttendanceJob(
  tx: Tx,
  actor: Actor | null,
  input: z.infer<typeof queueJobSchema>,
  source: Source = "ADMIN",
  scheduleKey?: string,
) {
  if (source === "ADMIN") {
    invariant(actor, "FORBIDDEN", "Operator identity required.", 403);
    requireOperator(actor);
  }
  if (actor) requireOperator(actor);
  invariant(
    input.workDate <= workDate(),
    "FUTURE_JOB",
    "Choose today or an earlier company date.",
  );
  const people = await tx.$queryRaw<
    { id: string }[]
  >`SELECT p.id FROM "Person" p WHERE p.status='ACTIVE' AND p.role<>'SUPER_ADMIN' AND EXISTS(SELECT 1 FROM "ScheduleAssignment" a WHERE a."userId"=p.id AND a."startDate"<=${dateValue(input.workDate)} AND (a."endDate" IS NULL OR a."endDate">=${dateValue(input.workDate)})) ORDER BY p.id LIMIT 1001`;
  invariant(
    people.length <= 1000,
    "JOB_LIMIT",
    "This job exceeds the 1000-person snapshot limit.",
    409,
  );
  const job = await tx.jobRun.create({
    data: {
      workDate: dateValue(input.workDate),
      reason: input.reason,
      source,
      requestedBy: actor?.id,
      audience: people.map((p) => p.id),
      total: people.length,
      scheduleKey,
    },
  });
  await audit(tx, actor?.id ?? null, "JOB_QUEUED", job.id, {
    kind: "ATTENDANCE",
    workDate: input.workDate,
    total: people.length,
    source,
    reason: input.reason,
  });
  return {
    id: job.id,
    version: job.version,
    status: job.status,
    total: people.length,
  };
}
export async function ensureScheduledAttendance(date: string) {
  z.iso.date().parse(date);
  const scheduleKey = `attendance:${date}`;
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scheduleKey},0))::text`;
    const existing = await tx.jobRun.findUnique({ where: { scheduleKey } });
    if (existing) return { id: existing.id };
    return createAttendanceJob(
      tx,
      null,
      { workDate: date, reason: "Daily attendance reconciliation" },
      "CRON",
      scheduleKey,
    );
  });
}
export async function claimAttendanceJob(
  id: string,
  key: string,
  actor: Actor | null,
  input: { expectedVersion?: number; reason: string },
  source: Source,
) {
  z.uuid().parse(id);
  z.string().min(8).max(128).parse(key);
  z.string().trim().min(1).max(500).parse(input.reason);
  return db.$transaction(async (tx) => {
    if (source === "ADMIN") {
      invariant(actor, "FORBIDDEN", "Operator identity required.", 403);
      await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${actor.id}::uuid FOR UPDATE`;
      const current = await tx.person.findUnique({ where: { id: actor.id } });
      invariant(
        current?.status === "ACTIVE",
        "ACCOUNT_INACTIVE",
        "This account is not active.",
        403,
      );
      requireOperator(current);
    }
    await tx.$queryRaw`SELECT id FROM "JobRun" WHERE id=${id}::uuid FOR UPDATE`;
    const job = await tx.jobRun.findUnique({ where: { id } });
    invariant(job, "NOT_FOUND", "Job not found.", 404);
    const replay = await tx.jobAttempt.findUnique({
      where: { runId_requestKey: { runId: id, requestKey: key } },
    });
    if (replay) return { started: false, attemptId: replay.id };
    if (input.expectedVersion !== undefined)
      expected(job.version, input.expectedVersion);
    invariant(
      job.status !== "SUCCEEDED",
      "JOB_COMPLETE",
      "This job is complete. Queue a new dated check if needed.",
      409,
    );
    invariant(
      job.status !== "RUNNING" ||
        !job.leaseUntil ||
        job.leaseUntil <= new Date(),
      "JOB_BUSY",
      "This job is already running. Refresh status shortly.",
      409,
    );
    if (job.activeAttemptId)
      await tx.jobAttempt.updateMany({
        where: { id: job.activeAttemptId, status: "RUNNING" },
        data: {
          status: "ABANDONED",
          endCursor: job.cursor,
          finishedAt: new Date(),
          errorCode: "LEASE_EXPIRED",
        },
      });
    const attempt = await tx.jobAttempt.create({
      data: {
        runId: id,
        requestKey: key,
        source,
        actorId: actor?.id,
        reason: input.reason,
        startCursor: job.cursor,
        endCursor: job.cursor,
      },
    });
    await tx.jobRun.update({
      where: { id },
      data: {
        status: "RUNNING",
        activeAttemptId: attempt.id,
        leaseUntil: new Date(Date.now() + 120000),
        errorCode: null,
        finishedAt: null,
        version: { increment: 1 },
      },
    });
    await audit(tx, actor?.id ?? null, "JOB_ATTEMPT_REQUESTED", id, {
      source,
      reason: input.reason,
      attemptId: attempt.id,
      from: job.status,
    });
    return { started: true, attemptId: attempt.id };
  });
}
type Processor = typeof reconcilePersonAttendance;
export async function processAttendanceClaim(
  id: string,
  attemptId: string,
  options: {
    deadline?: number;
    maxItems?: number;
    processPerson?: Processor;
  } = {},
) {
  const deadline = options.deadline ?? Date.now() + 35000,
    maxItems = options.maxItems ?? 1000,
    processor = options.processPerson ?? reconcilePersonAttendance;
  const attempt = await db.jobAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  try {
    for (let n = 0; n < maxItems && Date.now() < deadline - 5000; n++) {
      const complete = await db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "JobRun" WHERE id=${id}::uuid FOR UPDATE`;
          const job = await tx.jobRun.findUniqueOrThrow({ where: { id } });
          invariant(
            job.status === "RUNNING" &&
              job.activeAttemptId === attemptId &&
              job.leaseUntil &&
              job.leaseUntil > new Date(),
            "JOB_CLAIM_LOST",
            "This job claim changed.",
            409,
          );
          if (job.cursor >= job.audience.length) return true;
          if (attempt.source === "ADMIN" && attempt.actorId) {
            const operator = await tx.person.findUnique({
              where: { id: attempt.actorId },
            });
            invariant(
              operator?.status === "ACTIVE" && operator.role === "SUPER_ADMIN",
              "OPERATOR_REVOKED",
              "Operator access changed.",
              403,
            );
          }
          const result = await processor(
            tx,
            job.audience[job.cursor],
            job.workDate.toISOString().slice(0, 10),
            attempt.startedAt,
            { runId: id, actorId: attempt.actorId },
          );
          await tx.jobRun.update({
            where: { id },
            data: {
              cursor: { increment: 1 },
              updatedCount: { increment: result.updated },
              version: { increment: 1 },
            },
          });
          await tx.jobAttempt.update({
            where: { id: attemptId },
            data: { endCursor: job.cursor + 1 },
          });
          return job.cursor + 1 >= job.audience.length;
        },
        { timeout: 5000 },
      );
      if (complete) break;
    }
    await finishAttempt(id, attemptId, false);
  } catch (error) {
    await finishAttempt(
      id,
      attemptId,
      true,
      error instanceof AppError && error.code === "OPERATOR_REVOKED"
        ? "OPERATOR_REVOKED"
        : "ATTENDANCE_JOB_FAILED",
    );
  }
  return jobDto(id);
}
async function finishAttempt(
  id: string,
  attemptId: string,
  failed: boolean,
  errorCode = "ATTENDANCE_JOB_FAILED",
) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JobRun" WHERE id=${id}::uuid FOR UPDATE`;
    const job = await tx.jobRun.findUniqueOrThrow({ where: { id } });
    if (
      job.activeAttemptId !== attemptId ||
      job.status !== "RUNNING" ||
      !job.leaseUntil ||
      job.leaseUntil <= new Date()
    )
      return;
    const done = job.cursor === job.audience.length;
    const status = failed ? "FAILED" : done ? "SUCCEEDED" : "QUEUED";
    const attempt = await tx.jobAttempt.update({
      where: { id: attemptId },
      data: {
        status: failed ? "FAILED" : done ? "SUCCEEDED" : "PARTIAL",
        endCursor: job.cursor,
        finishedAt: new Date(),
        errorCode: failed ? errorCode : null,
      },
    });
    await tx.jobRun.update({
      where: { id },
      data: {
        status,
        activeAttemptId: null,
        leaseUntil: null,
        errorCode: failed ? errorCode : null,
        finishedAt: status === "QUEUED" ? null : new Date(),
        version: { increment: 1 },
      },
    });
    await audit(tx, attempt.actorId, "JOB_ATTEMPT_FINISHED", id, {
      attemptId,
      status,
      processed: job.cursor,
      total: job.audience.length,
      updated: job.updatedCount,
    });
  });
}
export async function runAttendanceJob(
  id: string,
  key: string,
  actor: Actor | null,
  input: { expectedVersion?: number; reason: string },
  source: Source = "ADMIN",
  options: Parameters<typeof processAttendanceClaim>[2] = {},
) {
  const claim = await claimAttendanceJob(id, key, actor, input, source);
  const result = claim.started
    ? await processAttendanceClaim(id, claim.attemptId, options)
    : await jobDto(id);
  if (result.status === "FAILED")
    throw new AppError(
      "JOB_FAILED",
      "Job stopped safely. Reload to review progress before retrying.",
      503,
    );
  return result;
}
export async function operationsSnapshot(actor: Actor) {
  requireOperator(actor);
  const current = await db.person.findUnique({ where: { id: actor.id } });
  invariant(
    current?.status === "ACTIVE",
    "ACCOUNT_INACTIVE",
    "This account is not active.",
    403,
  );
  requireOperator(current);
  const rows = await db.jobRun.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: safeJob,
  });
  const jobs = rows.map(presentJob);
  const lastAutomaticAttempt = await db.jobAttempt.findFirst({
    where: { source: "CRON" },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { runId: true, startedAt: true, finishedAt: true, status: true },
  });
  const queued = await db.outbox.count({
      where: { deliveredAt: null, canceledAt: null, attempts: { lt: 5 } },
    }),
    failed = await db.outbox.count({
      where: { deliveredAt: null, canceledAt: null, attempts: { gte: 5 } },
    });
  const maintenance = await db.maintenanceRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      source: true,
      status: true,
      attempts: true,
      leaseUntil: true,
      createdAt: true,
      finishedAt: true,
      errorCode: true,
      result: true,
    },
  });
  return {
    jobs,
    maintenance: maintenance.map(({ result, ...r }) => {
      const data = result as {
        date?: string;
        reportReminders?: number;
        expiredInvitations?: number;
      } | null;
      return {
        ...r,
        date: typeof data?.date === "string" ? data.date : null,
        reportReminders:
          typeof data?.reportReminders === "number" ? data.reportReminders : 0,
        expiredInvitations:
          typeof data?.expiredInvitations === "number"
            ? data.expiredInvitations
            : 0,
      };
    }),
    lastAutomaticAttempt,
    today: workDate(),
    previousDate: workDate(new Date(Date.now() - 86400000)),
    email: { status: emailStatus(), queued, failed },
    attendanceSchedule: {
      cron: "15 0 * * *",
      timezone: "UTC",
      companyTime: "05:15 Asia/Karachi (Hobby: hourly precision)",
      target: "Previous company day",
    },
  };
}
