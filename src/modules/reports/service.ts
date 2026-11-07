import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { independent } from "@/modules/tasks/policy";
import { workDate } from "@/lib/dates";
export const reportSchema = z
  .object({
    workDate: z.iso.date(),
    completedText: z.string().max(5000),
    remainingText: z.string().max(5000),
    blockersText: z.string().max(5000),
  })
  .strict();
export async function reportScope(actor: Actor, tx: Tx = db) {
  if (actor.role === "SUPER_ADMIN") return {};
  const teams = await tx.team.findMany({
    where: { leadId: actor.id, archivedAt: null },
    select: { id: true },
  });
  const members = await tx.employeeProfile.findMany({
    where: { teamId: { in: teams.map((t) => t.id) } },
    select: { userId: true },
  });
  return { userId: { in: [actor.id, ...members.map((p) => p.userId)] } };
}
export async function reports(actor: Actor) {
  return db.dailyReport.findMany({
    where: await reportScope(actor),
    orderBy: [{ workDate: "desc" }, { id: "asc" }],
    take: 100,
  });
}
export async function saveReport(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof reportSchema>,
) {
  invariant(
    input.workDate <= workDate(),
    "FUTURE_REPORT",
    "Reports cannot be written for future dates.",
  );
  const record = await tx.dailyReport.create({
    data: {
      ...input,
      userId: actor.id,
      workDate: new Date(`${input.workDate}T00:00:00Z`),
    },
  });
  await audit(tx, actor.id, "REPORT_DRAFTED", record.id);
  return record;
}
export async function editReport(
  tx: Tx,
  actor: Actor,
  id: string,
  input: {
    expectedVersion: number;
    completedText: string;
    remainingText: string;
    blockersText: string;
  },
) {
  const record = await tx.dailyReport.findFirst({
    where: { id, userId: actor.id },
  });
  invariant(record, "NOT_FOUND", "Report not found.", 404);
  expected(record.version, input.expectedVersion);
  invariant(
    record.status === "DRAFT",
    "IMMUTABLE_REPORT",
    "Submitted reports cannot be edited.",
    409,
  );
  const { expectedVersion: _, ...fields } = input;
  void _;
  return tx.dailyReport.update({
    where: { id },
    data: { ...fields, version: { increment: 1 } },
  });
}
export async function reportAction(
  tx: Tx,
  actor: Actor,
  id: string,
  input: {
    expectedVersion: number;
    action: "submit" | "acknowledge" | "return";
  },
) {
  await tx.$queryRaw`SELECT id FROM "DailyReport" WHERE id=${id}::uuid FOR UPDATE`;
  const record = await tx.dailyReport.findFirst({
    where: { id, ...(await reportScope(actor, tx)) },
  });
  invariant(record, "NOT_FOUND", "Report not found.", 404);
  expected(record.version, input.expectedVersion);
  if (input.action === "submit") {
    invariant(
      record.userId === actor.id,
      "FORBIDDEN",
      "Only the author can submit.",
      403,
    );
    invariant(
      record.status === "DRAFT",
      "INVALID_TRANSITION",
      "This report is already submitted.",
      409,
    );
    invariant(
      record.completedText.trim() ||
        record.remainingText.trim() ||
        record.blockersText.trim(),
      "EMPTY_REPORT",
      "Describe your work before submitting.",
    );
  } else {
    independent(actor.id, record.userId);
    invariant(
      record.status === "SUBMITTED",
      "INVALID_TRANSITION",
      "Only a submitted report can be reviewed.",
      409,
    );
  }
  const status =
    input.action === "submit"
      ? "SUBMITTED"
      : input.action === "return"
        ? "DRAFT"
        : "ACKNOWLEDGED";
  const updated = await tx.dailyReport.update({
    where: { id },
    data: {
      status,
      ...(input.action === "submit" ? { submittedAt: new Date() } : {}),
      acknowledgedBy: input.action === "acknowledge" ? actor.id : null,
      version: { increment: 1 },
    },
  });
  if (input.action === "return")
    await tx.reportRevision.create({
      data: {
        reportId: id,
        version: record.version,
        content: {
          completedText: record.completedText,
          remainingText: record.remainingText,
          blockersText: record.blockersText,
        },
      },
    });
  await audit(tx, actor.id, `REPORT_${input.action.toUpperCase()}`, id, {
    from: record.status,
    to: status,
  });
  return updated;
}
