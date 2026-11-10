import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import type {
  Prisma,
  PersonStatus,
  TaskStatus,
} from "@/generated/prisma/client";
import { invariant } from "@/server/errors";
import { audit, expected, type Tx } from "@/server/transaction";
import { assignmentWhere } from "@/modules/tasks/service";
import { reportStatusRows } from "@/modules/reports/status";
import { csvCell } from "@/lib/dates";
import {
  tableRegistry,
  tableQuerySchema,
  allowedColumns,
  type TableQuery,
  type TableEntity,
} from "./queries";
export type GridRow = {
  id: string;
  values: Record<string, string | number | null>;
  href: string;
  canEdit: boolean;
  person?: {
    id: string;
    version: number;
    displayName: string;
    username: string;
    employmentType: string;
  };
  task?: {
    id: string;
    version: number;
    title: string;
    description: string;
    priority: string;
    dueAt: string | null;
  };
};
function access(actor: Actor) {
  invariant(
    actor.role !== "HR_ADMIN",
    "FORBIDDEN",
    "Tables are outside the focused HR interface.",
    403,
  );
}
function pageFor(total: number, page: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size));
  return { page: Math.min(page, pages), pages };
}
async function peopleScope(actor: Actor): Promise<Prisma.PersonWhereInput> {
  if (actor.role === "SUPER_ADMIN") return {};
  if (actor.role === "TEAM_LEAD") {
    const teams = await db.team.findMany({
        where: { leadId: actor.id, archivedAt: null },
        select: { id: true },
      }),
      profiles = await db.employeeProfile.findMany({
        where: { teamId: { in: teams.map((t) => t.id) } },
        select: { userId: true },
      });
    return {
      OR: [
        { id: actor.id },
        { id: { in: profiles.map((p) => p.userId) } },
        {
          memberships: {
            some: {
              project: {
                managerId: actor.id,
                members: { some: { userId: actor.id } },
              },
            },
          },
        },
      ],
    };
  }
  return { id: actor.id };
}
export async function tableData(actor: Actor, query: TableQuery, size = 25) {
  access(actor);
  invariant(size >= 1 && size <= 10001, "PAGE_SIZE", "Invalid page size.");
  const sort =
    query.sort === "default"
      ? query.entity === "tasks"
        ? "createdAt"
        : "name"
      : query.sort;
  let rows: GridRow[] = [],
    total = 0,
    paging = { page: 1, pages: 1 };
  if (query.entity === "people") {
    const where: Prisma.PersonWhereInput = {
      AND: [
        await peopleScope(actor),
        ...(query.status === "all"
          ? []
          : [{ status: query.status as PersonStatus }]),
        ...(query.role === "all" ? [] : [{ role: query.role }]),
        ...(query.q
          ? [
              {
                OR: [
                  {
                    displayName: {
                      contains: query.q,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    username: {
                      contains: query.q,
                      mode: "insensitive" as const,
                    },
                  },
                  ...(actor.role === "SUPER_ADMIN"
                    ? [
                        {
                          email: {
                            contains: query.q,
                            mode: "insensitive" as const,
                          },
                        },
                      ]
                    : []),
                ],
              },
            ]
          : []),
      ],
    };
    const data = await db.$transaction(
      async (tx) => {
        const count = await tx.person.count({ where }),
          p = pageFor(count, query.page, size);
        const people = await tx.person.findMany({
          where,
          select: {
            id: true,
            version: true,
            displayName: true,
            username: true,
            role: true,
            status: true,
            employmentType: true,
            ...(actor.role === "SUPER_ADMIN" ? { email: true } : {}),
          },
          orderBy: [
            { [sort === "name" ? "displayName" : sort]: query.order },
            { id: "asc" },
          ],
          skip: (p.page - 1) * size,
          take: size,
        });
        return { people, count, p };
      },
      { isolationLevel: "RepeatableRead" },
    );
    total = data.count;
    paging = data.p;
    rows = data.people.map((p) => ({
      id: p.id,
      values: {
        name: p.displayName,
        username: "@" + p.username,
        role: p.role,
        status: p.status,
        employmentType: p.employmentType,
        ...("email" in p ? { email: String(p.email) } : {}),
      },
      href: actor.role === "SUPER_ADMIN" ? "/people/" + p.id : "/people",
      canEdit: actor.role === "SUPER_ADMIN",
      person: {
        id: p.id,
        version: p.version,
        displayName: p.displayName,
        username: p.username,
        employmentType: p.employmentType,
      },
    }));
  } else if (query.entity === "tasks") {
    const where: Prisma.TaskWhereInput = {
      AND: [
        assignmentWhere(actor, query.view, query.q, query.project),
        ...(query.deadline === "overdue"
          ? [
              {
                dueAt: { lt: new Date() },
                status: { notIn: ["APPROVED", "CANCELED"] as TaskStatus[] },
              },
            ]
          : []),
        ...(query.status === "all"
          ? []
          : [{ status: query.status as TaskStatus }]),
      ],
    };
    const orderBy: Prisma.TaskOrderByWithRelationInput =
      sort === "assignee"
        ? { assignee: { username: query.order } }
        : sort === "dueAt"
          ? { dueAt: { sort: query.order, nulls: "last" } }
          : { [sort]: query.order };
    const data = await db.$transaction(
      async (tx) => {
        const count = await tx.task.count({ where }),
          p = pageFor(count, query.page, size),
          tasks = await tx.task.findMany({
            where,
            orderBy: [orderBy, { id: "asc" }],
            take: size,
            skip: (p.page - 1) * size,
            include: {
              project: {
                select: { name: true, managerId: true, archivedAt: true },
              },
              assignee: { select: { username: true } },
              reviewer: { select: { username: true } },
            },
          });
        return { tasks, count, p };
      },
      { isolationLevel: "RepeatableRead" },
    );
    total = data.count;
    paging = data.p;
    rows = data.tasks.map((t) => ({
      id: t.id,
      values: {
        title: t.title,
        description: t.description,
        project: t.project.name,
        assignee: "@" + t.assignee.username,
        reviewer: "@" + t.reviewer.username,
        status: t.status,
        priority: t.priority,
        dueAt: t.dueAt?.toISOString() ?? null,
      },
      href: "/tasks/" + t.id,
      canEdit:
        !t.project.archivedAt &&
        !["APPROVED", "CANCELED", "IN_REVIEW"].includes(t.status) &&
        (actor.role === "SUPER_ADMIN" ||
          (actor.role === "TEAM_LEAD" && t.project.managerId === actor.id)),
      task: {
        id: t.id,
        version: t.version,
        title: t.title,
        description: t.description,
        priority: t.priority,
        dueAt: t.dueAt?.toISOString() ?? null,
      },
    }));
  } else {
    if (query.entity === "report-status") {
      const data = await reportStatusRows(actor, query.date);
      rows = data
        .filter(
          (p) =>
            (query.status === "all" || p.status === query.status) &&
            (!query.q ||
              `${p.displayName} ${p.username}`
                .toLowerCase()
                .includes(query.q.toLowerCase())),
        )
        .map((p) => ({
          id: p.id,
          values: {
            name: p.displayName,
            username: "@" + p.username,
            status: p.status,
            calendar: p.reason,
            late: p.timingRecorded
              ? p.late
                ? "Late"
                : "On time"
              : "Not recorded",
            date: query.date,
          },
          href: p.reportId
            ? "/reports/" + p.reportId
            : "/reports?date=" + query.date,
          canEdit: false,
        }));
    } else {
      const people = await db.person.findMany({
          where: {
            ...(actor.role === "SUPER_ADMIN"
              ? {
                  role: { not: "SUPER_ADMIN" },
                  status:
                    query.peopleStatus === "ALL"
                      ? { in: ["ACTIVE", "INACTIVE"] }
                      : query.peopleStatus,
                }
              : { id: actor.id }),
            ...(query.q
              ? {
                  OR: [
                    {
                      displayName: {
                        contains: query.q,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      username: {
                        contains: query.q,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                }
              : {}),
          },
          select: { id: true, displayName: true, username: true },
        }),
        days = await db.attendanceDay.findMany({
          where: {
            userId: { in: people.map((p) => p.id) },
            workDate: new Date(query.date),
          },
          select: {
            id: true,
            userId: true,
            firstIn: true,
            lastOut: true,
            status: true,
            grossMinutes: true,
          },
        });
      const time = (v: Date | null) =>
        v
          ? new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Karachi",
              hour: "2-digit",
              minute: "2-digit",
            }).format(v)
          : null;
      rows = people
        .map((p) => {
          const d = days.find((d) => d.userId === p.id),
            status =
              d?.status === "ON_LEAVE"
                ? "On leave"
                : d?.lastOut
                  ? "Checked out"
                  : d?.firstIn
                    ? "Checked in"
                    : "Not checked in";
          return {
            id: p.id,
            values: {
              name: p.displayName,
              username: "@" + p.username,
              status,
              attendanceStatus: d?.status ?? "Not recorded",
              firstIn: time(d?.firstIn ?? null),
              lastOut: time(d?.lastOut ?? null),
              grossMinutes: d?.grossMinutes ?? null,
            },
            href: d ? "/attendance/" + d.id : "/attendance",
            canEdit: false,
          };
        })
        .filter(
          (p) =>
            query.status === "all" ||
            p.values.status === query.status ||
            p.values.attendanceStatus === query.status,
        );
    }
    rows.sort((a, b) => {
      const x = a.values[sort],
        y = b.values[sort];
      if (x === null) return y === null ? a.id.localeCompare(b.id) : 1;
      if (y === null) return -1;
      return (
        String(x ?? "").localeCompare(String(y ?? ""), undefined, {
          numeric: true,
        }) * (query.order === "asc" ? 1 : -1) || a.id.localeCompare(b.id)
      );
    });
    total = rows.length;
    paging = pageFor(total, query.page, size);
    rows = rows.slice((paging.page - 1) * size, paging.page * size);
  }
  return {
    entity: query.entity,
    rows,
    total,
    ...paging,
    filters: { ...query, page: paging.page },
    columns: allowedColumns(query.entity, actor.role),
  };
}
export const savedViewSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    entity: z.enum(["people", "tasks", "attendance", "report-status"]),
    name: z.string().trim().min(1).max(60),
    columns: z.array(z.string()).min(1).max(10),
    filters: tableQuerySchema,
  })
  .strict();
export async function savedViews(actor: Actor, entity: TableEntity) {
  access(actor);
  return db.savedView.findMany({
    where: { userId: actor.id, entity },
    select: { id: true, name: true, version: true },
    orderBy: { name: "asc" },
  });
}
export async function savedView(actor: Actor, id: string) {
  access(actor);
  const item = await db.savedView.findFirst({
    where: { id, userId: actor.id },
  });
  invariant(item, "NOT_FOUND", "Saved view not found.", 404);
  const query = tableQuerySchema.safeParse(item.filters);
  invariant(
    query.success && query.data.entity === item.entity,
    "VIEW_OUTDATED",
    "This saved view needs updating.",
    409,
  );
  const columns = z
    .array(z.string())
    .parse(item.columns)
    .filter((c) => allowedColumns(query.data.entity, actor.role).includes(c));
  return {
    ...item,
    filters: query.data,
    columns: columns.length
      ? columns
      : tableRegistry[query.data.entity].defaults,
  };
}
export async function saveView(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof savedViewSchema>,
  id?: string,
) {
  access(actor);
  const columns = allowedColumns(input.entity, actor.role);
  invariant(
    input.filters.entity === input.entity &&
      new Set(input.columns).size === input.columns.length &&
      input.columns.every((c) => columns.includes(c)),
    "INVALID_VIEW",
    "Use allowed columns and filters for this table.",
  );
  const old = id
    ? await tx.savedView.findFirst({ where: { id, userId: actor.id } })
    : null;
  if (id) invariant(old, "NOT_FOUND", "Saved view not found.", 404);
  expected(old?.version ?? 0, input.expectedVersion);
  if (!old)
    invariant(
      (await tx.savedView.count({
        where: { userId: actor.id, entity: input.entity },
      })) < 20,
      "VIEW_LIMIT",
      "Keep up to 20 personal views per table.",
    );
  const data = {
    entity: input.entity,
    name: input.name,
    normalizedName: input.name.toLowerCase(),
    columns: input.columns,
    filters: { ...input.filters, page: 1 },
  };
  const item = old
    ? await tx.savedView.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      })
    : await tx.savedView.create({ data: { ...data, userId: actor.id } });
  await audit(tx, actor.id, "SAVED_VIEW_UPDATED", item.id, {
    entity: item.entity,
    columns: input.columns,
  });
  return { id: item.id, version: item.version };
}
export async function removeView(
  tx: Tx,
  actor: Actor,
  id: string,
  version: number,
) {
  access(actor);
  const old = await tx.savedView.findFirst({ where: { id, userId: actor.id } });
  invariant(old, "NOT_FOUND", "Saved view not found.", 404);
  expected(old.version, version);
  await tx.savedView.delete({ where: { id } });
  await audit(tx, actor.id, "SAVED_VIEW_REMOVED", id, { entity: old.entity });
  return { id, removed: true };
}
export async function exportTable(
  actor: Actor,
  query: TableQuery,
  requested?: string[],
) {
  const data = await tableData(actor, { ...query, page: 1 }, 10001);
  invariant(
    data.total <= 10000,
    "EXPORT_LIMIT",
    "Narrow filters to at most 10,000 rows.",
  );
  const columns = requested ?? tableRegistry[query.entity].defaults;
  invariant(
    columns.length > 0 &&
      new Set(columns).size === columns.length &&
      columns.every((c) =>
        allowedColumns(query.entity, actor.role).includes(c),
      ),
    "INVALID_COLUMNS",
    "Choose allowed export columns.",
  );
  const registry = tableRegistry[query.entity].columns as Record<
    string,
    string
  >;
  const csv = [
    columns.map((c) => csvCell(registry[c])).join(","),
    ...data.rows.map((r) => columns.map((c) => csvCell(r.values[c])).join(",")),
  ].join("\r\n");
  await db.$transaction(async (tx) => {
    const current = await tx.person.findUnique({ where: { id: actor.id } });
    invariant(
      current?.status === "ACTIVE" && current.role === actor.role,
      "PERMISSIONS_CHANGED",
      "Permissions changed; reload before exporting.",
      409,
    );
    await audit(tx, actor.id, "TABLE_EXPORTED", query.entity, {
      count: data.total,
      columns,
    });
  });
  return csv;
}
