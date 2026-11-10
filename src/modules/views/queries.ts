import { z } from "zod";
import { workDate } from "@/lib/dates";
export const entities = [
  "people",
  "tasks",
  "attendance",
  "report-status",
] as const;
export type TableEntity = (typeof entities)[number];
export const tableRegistry = {
  people: {
    title: "People",
    columns: {
      name: "Name",
      username: "Username",
      role: "Role",
      status: "Account status",
      employmentType: "Employment",
      email: "Work email",
    },
    defaults: ["name", "username", "role", "status", "employmentType"],
    sorts: ["name", "username", "role", "status", "createdAt"],
    statuses: ["all", "ACTIVE", "INACTIVE", "INVITED"],
  },
  tasks: {
    title: "Tasks",
    columns: {
      title: "Task",
      project: "Project",
      assignee: "Assignee",
      reviewer: "Reviewer",
      status: "Status",
      priority: "Priority",
      dueAt: "Deadline",
      description: "Instructions",
    },
    defaults: ["title", "project", "assignee", "status", "priority", "dueAt"],
    sorts: ["title", "dueAt", "status", "createdAt", "assignee"],
    statuses: [
      "all",
      "ASSIGNED",
      "IN_PROGRESS",
      "BLOCKED",
      "IN_REVIEW",
      "CHANGES_REQUESTED",
      "APPROVED",
      "CANCELED",
    ],
  },
  attendance: {
    title: "Attendance",
    columns: {
      name: "Person",
      username: "Username",
      status: "Check status",
      attendanceStatus: "Recorded status",
      firstIn: "Check in",
      lastOut: "Check out",
      grossMinutes: "Gross minutes",
    },
    defaults: [
      "name",
      "username",
      "status",
      "firstIn",
      "lastOut",
      "grossMinutes",
    ],
    sorts: ["name", "username", "status", "firstIn", "lastOut"],
    statuses: [
      "all",
      "Checked in",
      "Checked out",
      "Not checked in",
      "On leave",
      "ABSENT",
      "NEEDS_REVIEW",
      "HOLIDAY",
      "OFF_DAY",
    ],
  },
  "report-status": {
    title: "Report status",
    columns: {
      name: "Person",
      username: "Username",
      status: "Report status",
      calendar: "Calendar / cutoff",
      late: "Timing",
      date: "Work date",
    },
    defaults: ["name", "username", "status", "calendar", "late"],
    sorts: ["name", "username", "status", "late"],
    statuses: [
      "all",
      "missing",
      "not-due",
      "draft",
      "submitted",
      "acknowledged",
      "excused",
    ],
  },
};
export const tableQuerySchema = z
  .object({
    entity: z.enum(entities).default("tasks"),
    q: z.string().trim().max(100).default(""),
    status: z.string().default("all"),
    project: z.union([z.uuid(), z.literal("")]).default(""),
    date: z.iso.date().default(() => workDate()),
    sort: z.string().default("default"),
    order: z.enum(["asc", "desc"]).default("asc"),
    role: z
      .enum(["all", "SUPER_ADMIN", "HR_ADMIN", "TEAM_LEAD", "MEMBER"])
      .default("all"),
    peopleStatus: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
    deadline: z.enum(["all", "overdue"]).default("all"),
    view: z.enum(["all", "open", "review", "approved"]).default("all"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    const config = tableRegistry[v.entity];
    if (!config.statuses.includes(v.status))
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Choose a status for this table.",
      });
    if (v.sort !== "default" && !config.sorts.includes(v.sort))
      ctx.addIssue({
        code: "custom",
        path: ["sort"],
        message: "Choose an allowed sort column.",
      });
    if (
      ["attendance", "report-status"].includes(v.entity) &&
      v.date > workDate()
    )
      ctx.addIssue({
        code: "custom",
        path: ["date"],
        message: "Choose today or an earlier work date.",
      });
  });
export type TableQuery = z.infer<typeof tableQuerySchema>;
export function allowedColumns(entity: TableEntity, role: string) {
  return Object.keys(tableRegistry[entity].columns).filter(
    (k) => k !== "email" || role === "SUPER_ADMIN",
  );
}
