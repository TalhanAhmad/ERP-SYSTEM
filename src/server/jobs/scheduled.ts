import "server-only";
import { cleanupExpiredAnnouncements } from "@/modules/announcements/service";
import { db } from "../db";
import { workDate } from "@/lib/dates";
import { processOutbox } from "./outbox";
import { emailSender } from "./email";
import { emailStatus } from "@/lib/email-config";
import { ensureScheduledAttendance, runAttendanceJob } from "./monitoring";
// A real cursor/snapshot replaces clock-modulo user selection. Each person and
// its cursor checkpoint commit together; short passes leave resumable work.
export async function scheduledPass(
  send?: Parameters<typeof processOutbox>[0],
  emailInput: Record<string, unknown> = process.env,
  source: "CRON" | "CLI" = "CLI",
  allowEmail = false,
) {
  const deadline = Date.now() + 35000;
  await cleanupExpiredAnnouncements();
  const mailStatus = send ? "INJECTED" : emailStatus(emailInput);
  const sender =
    send ??
    (allowEmail && mailStatus === "READY"
      ? emailSender(emailInput)
      : undefined);
  const mail = sender ? await processOutbox(sender, 1) : { claimed: 0 };
  await ensureScheduledAttendance(workDate(new Date(Date.now() - 86400000)));
  const jobs: Awaited<ReturnType<typeof runAttendanceJob>>[] = [];
  let attendanceUpdated = 0;
  for (let n = 0; n < 5 && Date.now() < deadline - 5000; n++) {
    const candidate = await db.jobRun.findFirst({
      where: {
        OR: [
          { status: "QUEUED" },
          { status: "RUNNING", leaseUntil: { lt: new Date() } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!candidate) break;
    try {
      const job = await runAttendanceJob(
        candidate.id,
        crypto.randomUUID(),
        null,
        { reason: "Scheduled reconciliation/resume" },
        source,
        { deadline },
      );
      jobs.push(job);
      attendanceUpdated += Math.max(
        0,
        job.updatedCount - candidate.updatedCount,
      );
      if (job.status !== "SUCCEEDED") break;
    } catch (error) {
      if ((error as { code?: string }).code === "JOB_BUSY") continue;
      throw error;
    }
  }
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.idempotency.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return {
    mailClaimed: mail.claimed,
    mailStatus,
    attendanceUpdated,
    jobs,
    slice: jobs.length ? Math.floor(jobs[jobs.length - 1].processed / 20) : 0,
  };
}
