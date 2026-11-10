import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { visibleTasks } from "@/modules/tasks/service";
import { workDate } from "@/lib/dates";
const version = z.number().int().nonnegative(),
  reason = z.string().trim().min(1).max(1000).optional();
export const enrollmentSchema = z
  .object({
    expectedVersion: version,
    internId: z.uuid(),
    mentorId: z.uuid(),
    departmentId: z.uuid(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    objective: z.string().trim().min(1).max(5000),
    status: z.enum(["ACTIVE", "COMPLETED", "CANCELED"]).default("ACTIVE"),
    reason,
  })
  .strict()
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date must follow start date.",
    path: ["endDate"],
  })
  .refine((v) => v.internId !== v.mentorId, {
    message: "Mentor must be independent.",
    path: ["mentorId"],
  });
export const milestoneSchema = z
  .object({
    expectedVersion: version,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    dueDate: z.iso.date(),
    taskIds: z
      .array(z.uuid())
      .max(100)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export const milestoneActionSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(["ACTIVE", "SUBMITTED", "COMPLETED"]),
    reason,
  })
  .strict();
export const feedbackSchema = z
  .object({
    expectedVersion: version,
    weekStart: z.iso.date(),
    strengths: z.string().trim().min(1).max(5000),
    improvements: z.string().trim().min(1).max(5000),
    nextActions: z.string().trim().min(1).max(5000),
    rating: z.number().int().min(1).max(5).nullable(),
    ratingExplanation: z.string().trim().max(2000).nullable(),
    overrideReason: reason,
  })
  .strict()
  .refine((v) => v.rating === null || !!v.ratingExplanation, {
    message: "Explain the optional rating.",
    path: ["ratingExplanation"],
  });
export const internshipQuery = z
  .object({
    q: z.string().trim().max(100).default(""),
    status: z.enum(["all", "ACTIVE", "COMPLETED", "CANCELED"]).default("all"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export function internshipScope(actor: Actor) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "Internships are outside the focused HR interface.",
    403,
  );
  return actor.role === "SUPER_ADMIN"
    ? {}
    : actor.role === "TEAM_LEAD"
      ? { OR: [{ internId: actor.id }, { mentorId: actor.id }] }
      : { internId: actor.id };
}
export async function internshipOptions(actor: Actor) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin access required.",
    403,
  );
  const [people, departments] = await Promise.all([
    db.person.findMany({
      select: {
        id: true,
        displayName: true,
        username: true,
        role: true,
        status: true,
        employmentType: true,
      },
      orderBy: { displayName: "asc" },
    }),
    db.department.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    interns: people.filter(
      (p) => p.employmentType === "INTERN" && p.role !== "HR_ADMIN",
    ),
    mentors: people.filter((p) =>
      ["SUPER_ADMIN", "TEAM_LEAD"].includes(p.role),
    ),
    departments,
  };
}
export async function internshipDirectory(
  actor: Actor,
  query: z.infer<typeof internshipQuery>,
) {
  const scope = internshipScope(actor);
  const names = query.q
    ? await db.person.findMany({
        where: {
          OR: [
            { displayName: { contains: query.q, mode: "insensitive" } },
            { username: { contains: query.q, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      })
    : [];
  const where = {
    AND: [
      scope,
      ...(query.status !== "all" ? [{ status: query.status }] : []),
      ...(query.q
        ? [
            {
              OR: [
                { internId: { in: names.map((p) => p.id) } },
                { mentorId: { in: names.map((p) => p.id) } },
              ],
            },
          ]
        : []),
    ],
  };
  return db.$transaction(
    async (tx) => {
      const total = await tx.internship.count({ where }),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(query.page, pages),
        items = await tx.internship.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 25,
          skip: (page - 1) * 25,
        });
      const people = await tx.person.findMany({
        where: { id: { in: items.flatMap((i) => [i.internId, i.mentorId]) } },
        select: { id: true, displayName: true, username: true },
      });
      return {
        items: items.map((i) => ({
          ...i,
          intern: people.find((p) => p.id === i.internId),
          mentor: people.find((p) => p.id === i.mentorId),
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
async function enrollmentFor(tx: Tx, actor: Actor, id: string) {
  await tx.$queryRaw`SELECT id FROM "Internship" WHERE id=${id}::uuid FOR UPDATE`;
  const item = await tx.internship.findFirst({
    where: { id, ...internshipScope(actor) },
  });
  invariant(item, "NOT_FOUND", "Internship not found.", 404);
  return item;
}
type Enrollment = Awaited<ReturnType<typeof enrollmentFor>>;
function mentor(actor: Actor, item: Enrollment) {
  invariant(
    actor.id !== item.internId,
    "SELF_APPROVAL",
    "An independent mentor must review this work.",
    403,
  );
  invariant(
    actor.role === "SUPER_ADMIN" ||
      (actor.role === "TEAM_LEAD" && actor.id === item.mentorId),
    "FORBIDDEN",
    "Assigned mentor access required.",
    403,
  );
}
async function writable(tx: Tx, item: Enrollment) {
  invariant(
    item.status === "ACTIVE",
    "READ_ONLY_INTERNSHIP",
    "Reopen the enrollment before changing its learning records.",
    409,
  );
  invariant(
    await tx.person.findFirst({
      where: { id: item.internId, status: "ACTIVE" },
    }),
    "INACTIVE_INTERN",
    "The intern is inactive; learning records are read-only.",
    409,
  );
}
async function notify(
  tx: Tx,
  recipientId: string,
  eventKey: string,
  title: string,
  id: string,
) {
  await tx.notification.create({
    data: { recipientId, eventKey, title, target: "/internships/" + id },
  });
}
export async function saveEnrollment(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof enrollmentSchema>,
  id?: string,
) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin enrollment access required.",
    403,
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('internship-enrollment',0))::text`;
  const old = id ? await enrollmentFor(tx, actor, id) : null;
  expected(old?.version ?? 0, input.expectedVersion);
  const intern = await tx.person.findUnique({ where: { id: input.internId } }),
    lead = await tx.person.findUnique({ where: { id: input.mentorId } });
  invariant(
    intern?.employmentType === "INTERN",
    "INVALID_INTERN",
    "Select a person designated as an intern.",
  );
  invariant(
    lead &&
      ["SUPER_ADMIN", "TEAM_LEAD"].includes(lead.role) &&
      lead.id !== intern.id,
    "INVALID_MENTOR",
    "Select an independent Team Lead or Super Admin.",
  );
  invariant(
    await tx.department.findFirst({
      where: {
        id: input.departmentId,
        ...(input.status === "ACTIVE" ? { archivedAt: null } : {}),
      },
    }),
    "INVALID_DEPARTMENT",
    "Select a valid department.",
  );
  if (input.status === "ACTIVE")
    invariant(
      intern.status === "ACTIVE" &&
        intern.role !== "HR_ADMIN" &&
        lead.status === "ACTIVE",
      "INACTIVE_PARTICIPANT",
      "An active intern and active mentor are required.",
    );
  if (old) {
    invariant(
      old.internId === input.internId,
      "INTERN_FIXED",
      "Enrollment belongs to the original intern.",
    );
    invariant(
      input.reason?.trim(),
      "REASON_REQUIRED",
      "Explain the enrollment change.",
    );
    invariant(
      !(await tx.learningMilestone.count({
        where: {
          internshipId: id,
          OR: [
            { dueDate: { lt: new Date(input.startDate) } },
            { dueDate: { gt: new Date(input.endDate) } },
          ],
        },
      })),
      "MILESTONE_DATES",
      "Existing milestone dates must remain within the enrollment.",
    );
  }
  if (input.status === "ACTIVE")
    invariant(
      !(await tx.internship.count({
        where: {
          internId: input.internId,
          status: "ACTIVE",
          ...(id ? { id: { not: id } } : {}),
        },
      })),
      "ACTIVE_ENROLLMENT",
      "This intern already has an active enrollment.",
      409,
    );
  if (input.status === "COMPLETED") {
    invariant(
      old,
      "NO_MILESTONES",
      "Create an enrollment and learning plan first.",
    );
    const milestones = await tx.learningMilestone.findMany({
      where: { internshipId: id },
      select: { status: true },
    });
    invariant(
      milestones.length > 0 &&
        milestones.every((m) => m.status === "COMPLETED"),
      "INCOMPLETE_MILESTONES",
      "Complete all learning milestones before completing the enrollment.",
      409,
    );
  }
  const data = {
    internId: input.internId,
    mentorId: input.mentorId,
    departmentId: input.departmentId,
    startDate: new Date(input.startDate),
    endDate: new Date(input.endDate),
    objective: input.objective,
    status: input.status,
  };
  const item = old
    ? await tx.internship.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      })
    : await tx.internship.create({ data });
  await audit(
    tx,
    actor.id,
    old ? "INTERNSHIP_UPDATED" : "INTERNSHIP_ENROLLED",
    item.id,
    {
      internId: item.internId,
      mentorId: item.mentorId,
      departmentId: item.departmentId,
      status: item.status,
      ...(input.reason ? { reason: input.reason } : {}),
      previousMentorId: old?.mentorId ?? null,
    },
  );
  if (!old || old.mentorId !== item.mentorId)
    for (const recipientId of new Set([item.internId, item.mentorId]))
      await notify(
        tx,
        recipientId,
        `mentorship:${item.id}:${item.version}`,
        "An internship mentorship was assigned",
        item.id,
      );
  return { id: item.id, version: item.version, status: item.status };
}
async function validTasks(
  tx: Tx,
  actor: Actor,
  item: Enrollment,
  ids: string[],
) {
  invariant(
    (await tx.task.count({
      where: {
        id: { in: ids },
        assigneeId: item.internId,
        ...visibleTasks(actor),
      },
    })) === ids.length,
    "INVALID_EVIDENCE",
    "Link only accessible work assigned to this intern.",
  );
}
export async function saveMilestone(
  tx: Tx,
  actor: Actor,
  internshipId: string,
  input: z.infer<typeof milestoneSchema>,
  id?: string,
) {
  const item = await enrollmentFor(tx, actor, internshipId);
  mentor(actor, item);
  await writable(tx, item);
  const old = id
    ? await tx.learningMilestone.findFirst({ where: { id, internshipId } })
    : null;
  if (id) invariant(old, "NOT_FOUND", "Milestone not found.", 404);
  expected(old?.version ?? 0, input.expectedVersion);
  invariant(
    !old || ["PLANNED", "ACTIVE"].includes(old.status),
    "READ_ONLY_MILESTONE",
    "Return or reopen the milestone before editing its plan.",
    409,
  );
  const dueDate = new Date(input.dueDate);
  invariant(
    dueDate >= item.startDate && dueDate <= item.endDate,
    "MILESTONE_DATES",
    "The due date must fit the internship.",
  );
  await validTasks(tx, actor, item, input.taskIds);
  const data = { title: input.title, description: input.description, dueDate };
  const milestone = old
    ? await tx.learningMilestone.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      })
    : await tx.learningMilestone.create({ data: { ...data, internshipId } });
  await tx.milestoneTask.deleteMany({ where: { milestoneId: milestone.id } });
  if (input.taskIds.length)
    await tx.milestoneTask.createMany({
      data: input.taskIds.map((taskId) => ({
        milestoneId: milestone.id,
        taskId,
      })),
    });
  await audit(
    tx,
    actor.id,
    old ? "MILESTONE_UPDATED" : "MILESTONE_PLANNED",
    milestone.id,
    { internshipId, taskIds: input.taskIds },
  );
  return { id: milestone.id, version: milestone.version };
}
export async function milestoneAction(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof milestoneActionSchema>,
) {
  const first = await tx.learningMilestone.findUnique({ where: { id } });
  invariant(first, "NOT_FOUND", "Milestone not found.", 404);
  const item = await enrollmentFor(tx, actor, first.internshipId);
  await writable(tx, item);
  const milestone = await tx.learningMilestone.findUniqueOrThrow({
    where: { id },
  });
  expected(milestone.version, input.expectedVersion);
  const links = await tx.milestoneTask.findMany({ where: { milestoneId: id } }),
    ids = links.map((l) => l.taskId);
  if (input.status === "SUBMITTED") {
    invariant(
      actor.id === item.internId,
      "FORBIDDEN",
      "Only the intern submits milestone evidence.",
      403,
    );
    invariant(
      milestone.status === "ACTIVE",
      "INVALID_TRANSITION",
      "Activate the milestone before submitting evidence.",
      409,
    );
    invariant(
      workDate() >= item.startDate.toISOString().slice(0, 10) &&
        workDate() <= item.endDate.toISOString().slice(0, 10),
      "INTERNSHIP_DATES",
      "Submit evidence during the enrollment dates.",
    );
    invariant(
      ids.length,
      "NO_EVIDENCE",
      "The mentor must link required work first.",
    );
    await validTasks(tx, actor, item, ids);
    const tasks = await tx.task.findMany({
      where: { id: { in: ids } },
      select: { status: true, id: true },
    });
    const submissions = await tx.submission.findMany({
      where: { taskId: { in: ids }, submittedBy: item.internId },
      select: { taskId: true },
    });
    invariant(
      tasks.every(
        (t) =>
          ["IN_REVIEW", "APPROVED"].includes(t.status) &&
          submissions.some((s) => s.taskId === t.id),
      ),
      "EVIDENCE_NOT_READY",
      "Submit all linked work for review first.",
    );
  } else {
    mentor(actor, item);
    if (input.status === "ACTIVE") {
      invariant(
        ["PLANNED", "SUBMITTED", "COMPLETED"].includes(milestone.status),
        "INVALID_TRANSITION",
        "This milestone is already active.",
        409,
      );
      if (milestone.status !== "PLANNED")
        invariant(
          input.reason?.trim(),
          "REASON_REQUIRED",
          "Explain the milestone return or reopening.",
        );
    } else {
      invariant(
        milestone.status === "SUBMITTED",
        "INVALID_TRANSITION",
        "The intern must submit evidence first.",
        409,
      );
      invariant(ids.length, "NO_EVIDENCE", "Required work is missing.");
      if (actor.id !== item.mentorId)
        invariant(
          input.reason?.trim(),
          "OVERRIDE_REASON",
          "Explain the Super Admin mentor override.",
        );
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
      const tasks = await tx.task.findMany({
        where: {
          id: { in: ids },
          assigneeId: item.internId,
          status: "APPROVED",
          ...visibleTasks(actor),
        },
        select: { id: true, version: true },
      });
      invariant(
        tasks.length === ids.length,
        "UNAPPROVED_EVIDENCE",
        "All required tasks must still be approved work assigned to this intern.",
        409,
      );
      await audit(tx, actor.id, "MILESTONE_EVIDENCE_VERIFIED", id, { tasks });
    }
  }
  const result = await tx.learningMilestone.update({
    where: { id },
    data: {
      status: input.status,
      version: { increment: 1 },
      completedAt: input.status === "COMPLETED" ? new Date() : null,
      completedBy: input.status === "COMPLETED" ? actor.id : null,
    },
  });
  await audit(tx, actor.id, "MILESTONE_STATUS_CHANGED", id, {
    from: milestone.status,
    to: result.status,
    internshipId: item.id,
    ...(input.reason ? { reason: input.reason } : {}),
  });
  await notify(
    tx,
    input.status === "SUBMITTED" ? item.mentorId : item.internId,
    `milestone:${id}:${result.version}`,
    input.status === "SUBMITTED"
      ? "Milestone evidence is ready for review"
      : "Your learning milestone was updated",
    item.id,
  );
  return { id, status: result.status, version: result.version };
}
export async function saveFeedback(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof feedbackSchema>,
) {
  const item = await enrollmentFor(tx, actor, id);
  mentor(actor, item);
  await writable(tx, item);
  if (actor.id !== item.mentorId)
    invariant(
      input.overrideReason?.trim(),
      "OVERRIDE_REASON",
      "Explain the Super Admin mentor override.",
    );
  const week = new Date(input.weekStart);
  invariant(
    week.getUTCDay() === 1 &&
      input.weekStart <= workDate() &&
      week <= item.endDate &&
      new Date(week.getTime() + 6 * 86400000) >= item.startDate,
    "FEEDBACK_WEEK",
    "Choose a Monday in a current or past internship week.",
  );
  const old = await tx.weeklyFeedback.findUnique({
    where: { internshipId_weekStart: { internshipId: id, weekStart: week } },
  });
  expected(old?.version ?? 0, input.expectedVersion);
  const data = {
    strengths: input.strengths,
    improvements: input.improvements,
    nextActions: input.nextActions,
    rating: input.rating,
    ratingExplanation: input.ratingExplanation,
    updatedBy: actor.id,
  };
  const feedback = old
    ? await tx.weeklyFeedback.update({
        where: { id: old.id },
        data: { ...data, version: { increment: 1 } },
      })
    : await tx.weeklyFeedback.create({
        data: {
          ...data,
          internshipId: id,
          weekStart: week,
          authorId: actor.id,
        },
      });
  await audit(tx, actor.id, "INTERNSHIP_FEEDBACK_SAVED", feedback.id, {
    internshipId: id,
    weekStart: input.weekStart,
    ratingProvided: input.rating !== null,
    version: feedback.version,
    ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
  });
  return { id: feedback.id, version: feedback.version };
}
export async function internshipDetail(actor: Actor, id: string) {
  const item = await db.internship.findFirst({
    where: { id, ...internshipScope(actor) },
  });
  invariant(item, "NOT_FOUND", "Internship not found.", 404);
  const [people, department, milestones, feedback] = await Promise.all([
    db.person.findMany({
      where: { id: { in: [item.internId, item.mentorId] } },
      select: {
        id: true,
        displayName: true,
        username: true,
        role: true,
        status: true,
      },
    }),
    db.department.findUnique({
      where: { id: item.departmentId },
      select: { id: true, name: true },
    }),
    db.learningMilestone.findMany({
      where: { internshipId: id },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    }),
    db.weeklyFeedback.findMany({
      where: { internshipId: id },
      orderBy: { weekStart: "desc" },
    }),
  ]);
  const links = await db.milestoneTask.findMany({
    where: { milestoneId: { in: milestones.map((m) => m.id) } },
  });
  const tasks = await db.task.findMany({
    where: { id: { in: links.map((l) => l.taskId) }, ...visibleTasks(actor) },
    select: { id: true, title: true, status: true },
  });
  const canMentor =
    actor.role === "SUPER_ADMIN" ||
    (actor.role === "TEAM_LEAD" && actor.id === item.mentorId);
  const choices = canMentor
    ? await db.task.findMany({
        where: { assigneeId: item.internId, ...visibleTasks(actor) },
        select: { id: true, title: true, status: true },
        orderBy: { title: "asc" },
      })
    : [];
  return {
    ...item,
    intern: people.find((p) => p.id === item.internId),
    mentor: people.find((p) => p.id === item.mentorId),
    department,
    canMentor,
    milestones: milestones.map((m) => ({
      ...m,
      taskIds: links.filter((l) => l.milestoneId === m.id).map((l) => l.taskId),
      tasks: links
        .filter((l) => l.milestoneId === m.id)
        .flatMap((l) => tasks.filter((t) => t.id === l.taskId)),
    })),
    feedback,
    taskChoices: choices,
  };
}
