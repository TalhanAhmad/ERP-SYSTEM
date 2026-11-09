import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { invariant } from "@/server/errors";
import { workDate } from "@/lib/dates";
import { reportScope } from "./service";
export const reportStatusQuery = z
  .object({
    date: z.iso.date().default(() => workDate()),
    status: z
      .enum([
        "all",
        "missing",
        "not-due",
        "submitted",
        "acknowledged",
        "draft",
        "excused",
      ])
      .default("all"),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine((v) => v.date <= workDate(), {
    message: "Choose today or an earlier report date.",
    path: ["date"],
  });
export async function reportStatusRows(
  actor: Actor,
  date: string,
  now = new Date(),
) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "Report status access is outside the focused HR interface.",
    403,
  );
  const scope = await reportScope(actor),
    day = new Date(date);
  const [people, assignments, policies, holiday, reports, leaves, settings] =
    await Promise.all([
      db.person.findMany({
        where: {
          status: "ACTIVE",
          role: { not: "HR_ADMIN" },
          ...("userId" in scope ? { id: scope.userId } : {}),
        },
        select: { id: true, displayName: true, username: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      }),
      db.scheduleAssignment.findMany({
        where: {
          startDate: { lte: day },
          OR: [{ endDate: null }, { endDate: { gte: day } }],
        },
      }),
      db.schedulePolicy.findMany(),
      db.holiday.findUnique({ where: { date: day } }),
      db.dailyReport.findMany({
        where: { workDate: day, ...scope },
        select: {
          id: true,
          userId: true,
          status: true,
          late: true,
          cutoffSnapshot: true,
          firstSubmittedAt: true,
        },
      }),
      db.leaveDate.findMany({
        where: { workDate: day, active: true, request: { status: "APPROVED" } },
        select: { userId: true },
      }),
      db.companySettings.findUniqueOrThrow({ where: { id: "workspace" } }),
    ]);
  const cutoff = new Date(`${date}T${settings.reportCutoff}:00+05:00`),
    afterCutoff = now > cutoff;
  return people.map((p) => {
    const report = reports.find((r) => r.userId === p.id),
      assignment = assignments.find((a) => a.userId === p.id),
      policy = policies.find((x) => x.id === assignment?.policyId);
    const eligible =
      !!policy &&
      !holiday &&
      (policy.weekdays as number[]).includes(day.getUTCDay()) &&
      !leaves.some((l) => l.userId === p.id);
    const submitted = report && report.status !== "DRAFT";
    const status = submitted
      ? report.status === "ACKNOWLEDGED"
        ? "acknowledged"
        : "submitted"
      : !eligible
        ? "excused"
        : afterCutoff
          ? "missing"
          : report
            ? "draft"
            : "not-due";
    return {
      ...p,
      date,
      status,
      reportId: report?.id ?? null,
      late: report?.late ?? false,
      timingRecorded: !!report?.cutoffSnapshot,
      eligible,
      cutoff: cutoff.toISOString(),
      reason: holiday
        ? "Holiday"
        : leaves.some((l) => l.userId === p.id)
          ? "Approved leave"
          : !policy
            ? "No assigned schedule"
            : !(policy.weekdays as number[]).includes(day.getUTCDay())
              ? "Off-day"
              : afterCutoff
                ? "After report cutoff"
                : "Before report cutoff",
    };
  });
}
export async function reportStatusDirectory(
  actor: Actor,
  query: z.infer<typeof reportStatusQuery>,
) {
  const all = await reportStatusRows(actor, query.date),
    filtered = all.filter(
      (r) =>
        (query.status === "all" || r.status === query.status) &&
        (!query.q ||
          `${r.displayName} ${r.username}`
            .toLowerCase()
            .includes(query.q.toLowerCase())),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 25)),
    page = Math.min(query.page, pages);
  return {
    items: filtered.slice((page - 1) * 25, page * 25),
    total: filtered.length,
    page,
    pages,
    filters: { ...query, page },
    counts: {
      missing: all.filter((r) => r.status === "missing").length,
      submitted: all.filter((r) => r.status === "submitted").length,
      notDue: all.filter((r) => r.status === "not-due").length,
    },
  };
}
export const reportListQuery = z
  .object({
    date: z.union([z.iso.date(), z.literal("")]).default(""),
    status: z
      .enum(["all", "DRAFT", "SUBMITTED", "ACKNOWLEDGED"])
      .default("all"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export async function reportDirectory(
  actor: Actor,
  query: z.infer<typeof reportListQuery>,
) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "Private report access denied.",
    403,
  );
  const where = {
    ...(await reportScope(actor)),
    ...(query.date ? { workDate: new Date(query.date) } : {}),
    ...(query.status !== "all" ? { status: query.status } : {}),
  };
  return db.$transaction(
    async (tx) => {
      const total = await tx.dailyReport.count({ where }),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(query.page, pages),
        items = await tx.dailyReport.findMany({
          where,
          orderBy: [{ workDate: "desc" }, { id: "asc" }],
          take: 25,
          skip: (page - 1) * 25,
        });
      const people = await tx.person.findMany({
        where: { id: { in: items.map((r) => r.userId) } },
        select: { id: true, username: true, displayName: true },
      });
      return {
        items: items.map((r) => ({
          ...r,
          author: people.find((p) => p.id === r.userId),
        })),
        total,
        page,
        pages,
        filters: { ...query, page },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
