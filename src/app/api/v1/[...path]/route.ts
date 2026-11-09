import {
  organizationData,
  saveDepartment,
  saveTeam,
  saveEmployee,
  employeeDetail,
  departmentSchema,
  teamSchema,
  employeeSchema,
} from "@/modules/organization/service";
import {
  companySettings,
  saveSettings,
  settingsSchema,
} from "@/modules/settings/service";
import {
  projectDetail,
  editProject,
  archiveProject,
  removeProjectMember,
  editProjectSchema,
  archiveProjectSchema,
  projectVersionSchema,
} from "@/modules/projects/lifecycle";
import {
  taskDetail,
  editTask,
  reassignTask,
  managerTaskAction,
  addComment,
  editTaskSchema,
  reassignTaskSchema,
  taskActionSchema,
  commentSchema,
} from "@/modules/tasks/lifecycle";
import {
  calendarData,
  replaceSchedule,
  replaceScheduleSchema,
  saveHoliday,
  removeHoliday,
  holidaySchema,
  holidayEditSchema,
  versionSchema,
} from "@/modules/attendance/calendar";
import { assignmentQuerySchema } from "@/modules/tasks/queries";
import { projectQuerySchema } from "@/modules/projects/queries";
import { attendanceQuerySchema } from "@/modules/attendance/queries";
import { hrApiAccess } from "@/lib/hr-access";
import { hrOverview } from "@/modules/hr/service";
import {
  activeAnnouncement,
  announcementSchema,
  deleteAnnouncementSchema,
  saveAnnouncement,
  deleteAnnouncement,
} from "@/modules/announcements/service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { context } from "@/server/context";
import {
  operationsSnapshot,
  createAttendanceJob,
  queueJobSchema,
} from "@/server/jobs/monitoring";
import { db } from "@/server/db";
import { mutate } from "@/server/transaction";
import { dispatchInvitationEmail } from "@/server/jobs/invitation-email";
import { invariant } from "@/server/errors";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import {
  projectDirectory,
  listProjects,
  createProject,
  addMember,
} from "@/modules/projects/service";
import {
  listAssignments,
  listTasks,
  assign,
  changeStatus,
  submit,
  review,
} from "@/modules/tasks/service";
import { createTask, submitTask, reviewTask } from "@/modules/tasks/schemas";
import { dashboard } from "@/modules/projects/dashboard";
import { states } from "@/modules/tasks/policy";
import {
  invitationSchema,
  acceptSchema,
  invite,
  acceptInvitation,
  listInvitations,
  manageInvitationAction,
} from "@/modules/identity/service";
import {
  attendanceList,
  createPolicy,
  assignSchedule,
  check,
  requestLeave,
  decideLeave,
  requestCorrection,
  decideCorrection,
  hr,
} from "@/modules/attendance/service";
import {
  policySchema,
  assignmentSchema,
  leaveSchema,
  correctionSchema,
} from "@/modules/attendance/schemas";
import {
  reports,
  saveReport,
  editReport,
  reportAction,
  reportSchema,
} from "@/modules/reports/service";
import {
  changeRole,
  deactivate,
  reactivate,
  editProfile,
  personDetail,
  listPeople,
  profileSchema,
  peopleQuerySchema,
  accountStatusSchema,
  roleSchema,
} from "@/modules/people/service";
const uuid = z.uuid();
type Params = { params: Promise<{ path: string[] }> };
export async function GET(request: Request, { params }: Params) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await context(request.headers);
    const path = (await params).path.join("/");
    hrApiAccess(actor.role, "GET", path);
    if (path === "organization")
      return NextResponse.json({ data: await organizationData(actor) });
    if (path === "settings") {
      invariant(
        actor.role === "SUPER_ADMIN",
        "FORBIDDEN",
        "Super Admin required.",
        403,
      );
      return NextResponse.json({ data: await companySettings() });
    }
    if (/^employee-profiles\/[^/]+$/.test(path))
      return NextResponse.json({
        data: await employeeDetail(actor, uuid.parse(path.split("/")[1])),
      });
    if (/^projects\/[^/]+$/.test(path))
      return NextResponse.json({
        data: await projectDetail(actor, uuid.parse(path.split("/")[1])),
      });
    if (/^tasks\/[^/]+$/.test(path))
      return NextResponse.json({
        data: await taskDetail(actor, uuid.parse(path.split("/")[1])),
      });
    if (path === "calendar")
      return NextResponse.json({ data: await calendarData(actor) });
    if (path === "announcements")
      return NextResponse.json(
        { data: await activeAnnouncement() },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "hr/overview")
      return NextResponse.json(
        {
          data: await hrOverview(
            actor,
            attendanceQuerySchema.parse(
              Object.fromEntries(new URL(request.url).searchParams),
            ),
          ),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "operations")
      return NextResponse.json(
        { data: await operationsSnapshot(actor) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "people")
      return NextResponse.json(
        {
          data: await listPeople(
            actor,
            peopleQuerySchema.parse(
              Object.fromEntries(new URL(request.url).searchParams),
            ),
          ),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (/^users\/[^/]+$/.test(path))
      return NextResponse.json(
        { data: await personDetail(actor, uuid.parse(path.split("/")[1])) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "me")
      return NextResponse.json({
        data: {
          id: actor.id,
          displayName: actor.displayName,
          username: actor.username,
          email: actor.email,
          role: actor.role,
        },
      });
    if (path === "invitations")
      return NextResponse.json({ data: await listInvitations(actor) });
    if (path === "attendance" || path === "attendance/me")
      return NextResponse.json({
        data: await attendanceList(
          path === "attendance/me" ? { ...actor, role: "MEMBER" } : actor,
        ),
      });
    if (path === "leave")
      return NextResponse.json({
        data: await db.leaveRequest.findMany({
          where: hr(actor) ? {} : { userId: actor.id },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      });
    if (path === "corrections")
      return NextResponse.json({
        data: await db.attendanceCorrection.findMany({
          where: hr(actor) ? {} : { requestedBy: actor.id },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      });
    if (path === "schedules") {
      invariant(hr(actor), "FORBIDDEN", "HR access required.", 403);
      return NextResponse.json({
        data: await db.schedulePolicy.findMany({
          orderBy: { createdAt: "desc" },
        }),
      });
    }
    if (path === "reports")
      return NextResponse.json({ data: await reports(actor) });
    if (path === "assignments")
      return NextResponse.json(
        {
          data: await listAssignments(
            actor,
            assignmentQuerySchema.parse(
              Object.fromEntries(new URL(request.url).searchParams),
            ),
          ),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "project-directory")
      return NextResponse.json(
        {
          data: await projectDirectory(
            actor,
            projectQuerySchema.parse(
              Object.fromEntries(new URL(request.url).searchParams),
            ),
          ),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (path === "projects")
      return NextResponse.json({ data: await listProjects(actor) });
    if (path === "tasks")
      return NextResponse.json({ data: await listTasks(actor) });
    if (path === "users") {
      const search = new URL(request.url).searchParams.get("q") ?? "";
      invariant(search.length <= 100, "INVALID_SEARCH", "Search is too long.");
      const privileged = ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role);
      const managed = await db.project.findMany({
        where: { managerId: actor.id },
        select: { id: true },
      });
      const people = await db.person.findMany({
        where: {
          AND: [
            privileged
              ? {}
              : {
                  OR: [
                    { id: actor.id },
                    {
                      memberships: {
                        some: { projectId: { in: managed.map((p) => p.id) } },
                      },
                    },
                  ],
                },
            {
              OR: [
                { username: { contains: search, mode: "insensitive" } },
                { displayName: { contains: search, mode: "insensitive" } },
              ],
            },
          ],
        },
        select: {
          id: true,
          displayName: true,
          username: true,
          role: true,
          status: true,
          employmentType: true,
        },
        orderBy: { username: "asc" },
        take: 100,
      });
      return NextResponse.json({ data: people });
    }
    if (path === "notifications")
      return NextResponse.json({
        data: await db.notification.findMany({
          where: { recipientId: actor.id },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      });
    if (path === "audit") {
      invariant(
        actor.role === "SUPER_ADMIN",
        "FORBIDDEN",
        "Super admin access required.",
        403,
      );
      return NextResponse.json({
        data: await db.audit.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      });
    }
    if (path === "dashboard")
      return NextResponse.json({ data: await dashboard(actor) });
    throw new (await import("@/server/errors")).AppError(
      "NOT_FOUND",
      "Endpoint not found.",
      404,
    );
  } catch (error) {
    return failure(error, requestId);
  }
}
export async function POST(request: Request, { params }: Params) {
  const requestId = crypto.randomUUID();
  try {
    mutationOrigin(request);
    const path = (await params).path;
    const route = path.join("/");
    const input = await jsonBody(request);
    if (route === "invitations/accept") {
      // A single shared database bucket avoids trusting spoofable proxy/client IP headers.
      await rateLimit("public-invitation-accept", 20);
      return NextResponse.json({
        data: await acceptInvitation(acceptSchema.parse(input)),
      });
    }
    const actor = await context(request.headers);
    hrApiAccess(actor.role, request.method, (await params).path.join("/"));
    await rateLimit(`mutation:${actor.id}`);
    const data = await mutate(
      actor,
      route,
      request.headers.get("idempotency-key"),
      input,
      async (tx) => {
        if (route === "settings")
          return saveSettings(tx, actor, settingsSchema.parse(input));
        if (path[0] === "departments" && path.length <= 2)
          return saveDepartment(
            tx,
            actor,
            departmentSchema.parse(input),
            path[1] ? uuid.parse(path[1]) : undefined,
          );
        if (path[0] === "teams" && path.length <= 2)
          return saveTeam(
            tx,
            actor,
            teamSchema.parse(input),
            path[1] ? uuid.parse(path[1]) : undefined,
          );
        if (path[0] === "employee-profiles" && path.length === 2)
          return saveEmployee(
            tx,
            actor,
            uuid.parse(path[1]),
            employeeSchema.parse(input),
          );
        if (route === "announcements")
          return saveAnnouncement(tx, actor, announcementSchema.parse(input));
        if (route === "announcements/delete")
          return deleteAnnouncement(
            tx,
            actor,
            deleteAnnouncementSchema.parse(input),
          );
        if (route === "operations/attendance-jobs")
          return createAttendanceJob(tx, actor, queueJobSchema.parse(input));
        if (path[0] === "invitations" && path.length === 3) {
          const body = z
            .object({ expectedVersion: z.number().int().positive() })
            .strict()
            .parse(input);
          return manageInvitationAction(tx, actor, uuid.parse(path[1]), {
            ...body,
            action: z.enum(["resend", "revoke"]).parse(path[2]),
          });
        }
        if (path[0] === "users" && path.length === 3) {
          const id = uuid.parse(path[1]);
          if (path[2] === "role")
            return changeRole(tx, actor, id, roleSchema.parse(input));
          if (path[2] === "deactivate")
            return deactivate(tx, actor, id, accountStatusSchema.parse(input));
          if (path[2] === "reactivate")
            return reactivate(tx, actor, id, accountStatusSchema.parse(input));
        }
        if (
          path[0] === "schedule-assignments" &&
          path.length === 3 &&
          path[2] === "replace"
        )
          return replaceSchedule(
            tx,
            actor,
            uuid.parse(path[1]),
            replaceScheduleSchema.parse(input),
          );
        if (route === "holidays")
          return saveHoliday(tx, actor, holidaySchema.parse(input));
        if (path[0] === "holidays" && path.length === 3 && path[2] === "remove")
          return removeHoliday(
            tx,
            actor,
            uuid.parse(path[1]),
            versionSchema.parse(input),
          );
        if (route === "schedules")
          return createPolicy(tx, actor, policySchema.parse(input));
        if (route === "schedule-assignments")
          return assignSchedule(tx, actor, assignmentSchema.parse(input));
        if (
          route === "attendance/check-in" ||
          route === "attendance/check-out"
        ) {
          z.object({}).strict().parse(input);
          return check(tx, actor, route.endsWith("check-in") ? "IN" : "OUT");
        }
        if (route === "leave")
          return requestLeave(tx, actor, leaveSchema.parse(input));
        if (route === "corrections")
          return requestCorrection(tx, actor, correctionSchema.parse(input));
        if (path.length === 3 && ["leave", "corrections"].includes(path[0])) {
          const version = z
            .object({ expectedVersion: z.number().int().positive() })
            .strict()
            .parse(input);
          const id = uuid.parse(path[1]);
          if (path[0] === "leave")
            return decideLeave(tx, actor, id, {
              ...version,
              action: z.enum(["approve", "reject", "cancel"]).parse(path[2]),
            });
          return decideCorrection(tx, actor, id, {
            ...version,
            action: z.enum(["approve", "reject"]).parse(path[2]),
          });
        }
        if (route === "reports")
          return saveReport(tx, actor, reportSchema.parse(input));
        if (path[0] === "reports" && path.length === 3) {
          const version = z
            .object({ expectedVersion: z.number().int().positive() })
            .strict()
            .parse(input);
          return reportAction(tx, actor, uuid.parse(path[1]), {
            ...version,
            action: z.enum(["submit", "acknowledge", "return"]).parse(path[2]),
          });
        }
        if (route === "projects")
          return createProject(
            tx,
            actor,
            z
              .object({
                name: z.string().trim().min(1).max(120),
                description: z.string().max(5000).default(""),
              })
              .strict()
              .parse(input),
          );
        if (
          path[0] === "projects" &&
          path[2] === "members" &&
          path.length === 3
        )
          return addMember(
            tx,
            actor,
            uuid.parse(path[1]),
            z.object({ userId: uuid }).strict().parse(input).userId,
          );
        if (
          path[0] === "projects" &&
          path.length === 3 &&
          ["archive", "restore"].includes(path[2])
        )
          return archiveProject(
            tx,
            actor,
            uuid.parse(path[1]),
            archiveProjectSchema.parse(input),
            path[2] === "restore",
          );
        if (
          path[0] === "projects" &&
          path.length === 5 &&
          path[2] === "members" &&
          path[4] === "remove"
        )
          return removeProjectMember(
            tx,
            actor,
            uuid.parse(path[1]),
            uuid.parse(path[3]),
            projectVersionSchema.parse(input),
          );
        if (path[0] === "tasks" && path.length === 3) {
          const id = uuid.parse(path[1]);
          if (path[2] === "reassign")
            return reassignTask(tx, actor, id, reassignTaskSchema.parse(input));
          if (path[2] === "comments")
            return addComment(tx, actor, id, commentSchema.parse(input));
          if (["cancel", "reopen", "return"].includes(path[2]))
            return managerTaskAction(
              tx,
              actor,
              id,
              z.enum(["cancel", "reopen", "return"]).parse(path[2]),
              taskActionSchema.parse(input),
            );
        }
        if (route === "tasks")
          return assign(tx, actor, createTask.parse(input));
        if (path[0] === "tasks" && path.length === 3) {
          const id = uuid.parse(path[1]);
          if (path[2] === "status")
            return changeStatus(
              tx,
              actor,
              id,
              z
                .object({
                  expectedVersion: z.number().int().positive(),
                  status: z.enum(states),
                })
                .strict()
                .parse(input),
            );
          if (path[2] === "submissions")
            return submit(tx, actor, id, submitTask.parse(input));
        }
        if (
          path[0] === "submissions" &&
          path[2] === "review" &&
          path.length === 3
        )
          return review(
            tx,
            actor,
            uuid.parse(path[1]),
            reviewTask.parse(input),
          );
        if (route === "invitations")
          return invite(tx, actor, invitationSchema.parse(input));
        if (
          path[0] === "notifications" &&
          path[2] === "read" &&
          path.length === 3
        ) {
          z.object({}).strict().parse(input);
          const id = uuid.parse(path[1]);
          const found = await tx.notification.findFirst({
            where: { id, recipientId: actor.id },
          });
          invariant(found, "NOT_FOUND", "Notification not found.", 404);
          return tx.notification.update({
            where: { id },
            data: { readAt: new Date() },
          });
        }
        throw new (await import("@/server/errors")).AppError(
          "NOT_FOUND",
          "Endpoint not found.",
          404,
        );
      },
    );
    if (
      route === "invitations" ||
      (path[0] === "invitations" && path.length === 3 && path[2] === "resend")
    ) {
      const result = z.object({ id: uuid }).parse(data);
      await dispatchInvitationEmail(result.id);
    }
    return NextResponse.json({ data });
  } catch (error) {
    return failure(error, requestId);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const requestId = crypto.randomUUID();
  try {
    mutationOrigin(request);
    const actor = await context(request.headers);
    hrApiAccess(actor.role, request.method, (await params).path.join("/"));
    await rateLimit(`mutation:${actor.id}`);
    const path = (await params).path;
    const input = await jsonBody(request);
    if (path.length === 2 && ["projects", "tasks"].includes(path[0])) {
      return NextResponse.json({
        data: await mutate(
          actor,
          `PATCH:${path.join("/")}`,
          request.headers.get("idempotency-key"),
          input,
          (tx) =>
            path[0] === "projects"
              ? editProject(
                  tx,
                  actor,
                  uuid.parse(path[1]),
                  editProjectSchema.parse(input),
                )
              : editTask(
                  tx,
                  actor,
                  uuid.parse(path[1]),
                  editTaskSchema.parse(input),
                ),
        ),
      });
    }
    if (path[0] === "holidays" && path.length === 2) {
      const body = holidayEditSchema.parse(input);
      return NextResponse.json({
        data: await mutate(
          actor,
          `PATCH:${path.join("/")}`,
          request.headers.get("idempotency-key"),
          input,
          (tx) =>
            saveHoliday(
              tx,
              actor,
              body,
              uuid.parse(path[1]),
              body.expectedVersion,
            ),
        ),
      });
    }
    if (path[0] === "users" && path.length === 2) {
      const data = await mutate(
        actor,
        `PATCH:${path.join("/")}`,
        request.headers.get("idempotency-key"),
        input,
        (tx) =>
          editProfile(
            tx,
            actor,
            uuid.parse(path[1]),
            profileSchema.parse(input),
          ),
      );
      return NextResponse.json({ data });
    }
    invariant(
      path[0] === "reports" && path.length === 2,
      "NOT_FOUND",
      "Endpoint not found.",
      404,
    );
    const fields = z
      .object({
        expectedVersion: z.number().int().positive(),
        completedText: z.string().max(5000),
        remainingText: z.string().max(5000),
        blockersText: z.string().max(5000),
      })
      .strict()
      .parse(input);
    const data = await mutate(
      actor,
      `PATCH:${path.join("/")}`,
      request.headers.get("idempotency-key"),
      input,
      (tx) => editReport(tx, actor, uuid.parse(path[1]), fields),
    );
    return NextResponse.json({ data });
  } catch (error) {
    return failure(error, requestId);
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;
