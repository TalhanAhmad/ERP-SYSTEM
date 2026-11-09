import { z } from "zod";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { expected, type Tx } from "@/server/transaction";
import "server-only";
import { db } from "../db";
import { workDate } from "@/lib/dates";
import { reportStatusRows } from "@/modules/reports/status";
import { audit } from "../transaction";
export async function maintenancePass(
  date: string,
  source: "CRON" | "CLI" | "ADMIN" = "CLI",
  runKey = `maintenance:${date}`,
) {
  z.iso.date().parse(date);
  invariant(
    date <= workDate(),
    "FUTURE_JOB",
    "Choose today or an earlier company date.",
  );
  const claim = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${runKey},0))::text`;
    const old = await tx.maintenanceRun.findUnique({ where: { runKey } });
    if (
      old?.status === "SUCCEEDED" ||
      (old?.status === "RUNNING" &&
        old.leaseUntil &&
        old.leaseUntil > new Date())
    )
      return null;
    return tx.maintenanceRun.upsert({
      where: { runKey },
      create: { runKey, source, leaseUntil: new Date(Date.now() + 300000) },
      update: {
        status: "RUNNING",
        source,
        leaseUntil: new Date(Date.now() + 300000),
        attempts: { increment: 1 },
        errorCode: null,
        finishedAt: null,
      },
    });
  });
  if (!claim) return { skipped: true };
  try {
    const root = await db.person.findFirst({
        where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      }),
      settings = await db.companySettings.findUniqueOrThrow({
        where: { id: "workspace" },
      });
    const rows =
      root && settings.reportReminders
        ? await reportStatusRows(root, date)
        : [];
    const missing = rows.filter((r) => r.status === "missing");
    const result = await db.$transaction(
      async (tx) => {
        const expired = await tx.invitation.findMany({
          where: {
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { lt: new Date() },
            OR: [
              { provisioningStatus: { not: "PROVISIONING" } },
              { provisioningLeaseUntil: { lt: new Date() } },
            ],
          },
          select: { id: true },
        });
        if (expired.length) {
          await tx.invitation.updateMany({
            where: { id: { in: expired.map((i) => i.id) } },
            data: { revokedAt: new Date(), version: { increment: 1 } },
          });
          await tx.outbox.updateMany({
            where: {
              invitationId: { in: expired.map((i) => i.id) },
              deliveredAt: null,
              canceledAt: null,
            },
            data: { canceledAt: new Date(), leaseUntil: null },
          });
        }
        const ids = missing.map((p) => p.id);
        if (ids.length)
          await tx.$queryRaw`SELECT id FROM "Person" WHERE id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
        const active = await tx.person.findMany({
            where: { id: { in: ids }, status: "ACTIVE" },
            select: { id: true },
          }),
          prefs = await tx.notificationPreference.findMany({
            where: { userId: { in: ids }, reportReminders: false },
            select: { userId: true },
          });
        const notified = await tx.notification.createMany({
          data: active
            .filter((p) => !prefs.some((v) => v.userId === p.id))
            .map((p) => ({
              recipientId: p.id,
              eventKey: `report-reminder:${date}`,
              title: "Your daily report is still missing",
              target: `/reports?date=${date}`,
            })),
          skipDuplicates: true,
        });
        const payload = {
          date,
          expiredInvitations: expired.length,
          reportReminders: notified.count,
          reportReminderStatus: root ? "READY" : "NO_ADMIN",
        };
        const updated = await tx.maintenanceRun.updateMany({
          where: {
            id: claim.id,
            leaseUntil: claim.leaseUntil,
            status: "RUNNING",
          },
          data: {
            status: "SUCCEEDED",
            result: payload,
            leaseUntil: null,
            finishedAt: new Date(),
          },
        });
        if (!updated.count) throw new Error("MAINTENANCE_LEASE_CHANGED");
        await audit(tx, null, "MAINTENANCE_COMPLETED", claim.id, payload);
        return payload;
      },
      { timeout: 15000 },
    );
    return { skipped: false, ...result };
  } catch {
    await db.maintenanceRun.updateMany({
      where: { id: claim.id, leaseUntil: claim.leaseUntil },
      data: {
        status: "FAILED",
        errorCode: "MAINTENANCE_FAILED",
        leaseUntil: null,
        finishedAt: new Date(),
      },
    });
    throw new Error("Maintenance processing failed; check Operations.");
  }
}
export const previousCompanyDate = () =>
  workDate(new Date(Date.now() - 86400000));

export const maintenanceRequestSchema = z
  .object({
    workDate: z.iso.date(),
    reason: z.string().trim().min(1).max(500),
    runId: z.uuid().optional(),
    expectedAttempts: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((v) => !v.runId || v.expectedAttempts !== undefined, {
    message: "Provide the current attempt count when retrying.",
  });
export async function queueMaintenance(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof maintenanceRequestSchema>,
) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin access required.",
    403,
  );
  invariant(
    input.workDate <= workDate(),
    "FUTURE_JOB",
    "Choose today or an earlier company date.",
  );
  let run;
  if (input.runId) {
    await tx.$queryRaw`SELECT id FROM "MaintenanceRun" WHERE id=${input.runId}::uuid FOR UPDATE`;
    run = await tx.maintenanceRun.findUnique({ where: { id: input.runId } });
    invariant(run, "NOT_FOUND", "Maintenance run not found.", 404);
    expected(run.attempts, input.expectedAttempts!);
    invariant(
      run.status === "FAILED" ||
        (run.status === "RUNNING" &&
          (!run.leaseUntil || run.leaseUntil < new Date())),
      "JOB_BUSY",
      "This run is complete or currently processing.",
      409,
    );
    invariant(
      (run.result as { date?: string } | null)?.date === input.workDate,
      "DATE_CHANGED",
      "Retry the same work date.",
    );
  } else
    run = await tx.maintenanceRun.create({
      data: {
        runKey: "admin:" + crypto.randomUUID(),
        source: "ADMIN",
        status: "RUNNING",
        attempts: 0,
        leaseUntil: new Date(0),
        result: { date: input.workDate },
      },
    });
  await audit(tx, actor.id, "MAINTENANCE_REQUESTED", run.id, {
    workDate: input.workDate,
    reason: input.reason,
    retry: !!input.runId,
  });
  return { id: run.id, runKey: run.runKey, date: input.workDate };
}
