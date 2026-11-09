import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
const version = z.number().int().nonnegative();
const nullableId = z.uuid().nullable();
export const departmentSchema = z
  .object({
    expectedVersion: version,
    name: z.string().trim().min(1).max(120),
    archived: z.boolean().default(false),
  })
  .strict();
export const teamSchema = departmentSchema.extend({
  departmentId: z.uuid(),
  leadId: z.uuid(),
});
export const employeeSchema = z
  .object({
    expectedVersion: version,
    departmentId: nullableId,
    teamId: nullableId,
    managerId: nullableId,
    joiningDate: z.iso.date().nullable(),
    internshipEndDate: z.iso.date().nullable(),
    workMode: z.enum(["OFFICE", "REMOTE", "HYBRID"]),
    privateContact: z.string().trim().max(500).nullable(),
  })
  .strict()
  .refine(
    (v) =>
      !v.internshipEndDate ||
      !v.joiningDate ||
      v.internshipEndDate >= v.joiningDate,
    {
      message: "Internship end must follow the joining date.",
      path: ["internshipEndDate"],
    },
  );
function root(actor: Actor) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin access required.",
    403,
  );
}
async function lock(tx: Tx) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('organization-hierarchy',0))::text`;
}
export async function organizationData(actor: Actor) {
  root(actor);
  const [departments, teams, profiles, people] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.team.findMany({ orderBy: { name: "asc" } }),
    db.employeeProfile.findMany(),
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
  ]);
  return {
    departments,
    teams,
    profiles: profiles.map(({ privateContact: _, ...p }) => {
      void _;
      return p;
    }),
    people,
  };
}
export async function saveDepartment(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof departmentSchema>,
  id?: string,
) {
  root(actor);
  await lock(tx);
  const old = id ? await tx.department.findUnique({ where: { id } }) : null;
  if (id) invariant(old, "NOT_FOUND", "Department not found.", 404);
  expected(old?.version ?? 0, input.expectedVersion);
  if (input.archived)
    invariant(
      !(await tx.internship.count({
        where: { departmentId: id, status: "ACTIVE" },
      })) &&
        !(await tx.team.count({
          where: { departmentId: id, archivedAt: null },
        })) &&
        !(await tx.employeeProfile.count({ where: { departmentId: id } })),
      "DEPARTMENT_IN_USE",
      "Move teams and employee profiles before archiving this department.",
      409,
    );
  const data = {
    name: input.name,
    normalizedName: input.name.toLowerCase(),
    archivedAt: input.archived ? new Date() : null,
  };
  const item = old
    ? await tx.department.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      })
    : await tx.department.create({ data });
  await audit(
    tx,
    actor.id,
    old ? "DEPARTMENT_UPDATED" : "DEPARTMENT_CREATED",
    item.id,
    { name: item.name, archived: input.archived },
  );
  return item;
}
export async function saveTeam(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof teamSchema>,
  id?: string,
) {
  root(actor);
  await lock(tx);
  const old = id ? await tx.team.findUnique({ where: { id } }) : null;
  if (id) invariant(old, "NOT_FOUND", "Team not found.", 404);
  expected(old?.version ?? 0, input.expectedVersion);
  invariant(
    await tx.department.findFirst({
      where: { id: input.departmentId, archivedAt: null },
    }),
    "INVALID_DEPARTMENT",
    "Select an active department.",
  );
  invariant(
    await tx.person.findFirst({
      where: {
        id: input.leadId,
        status: "ACTIVE",
        role: { in: ["SUPER_ADMIN", "TEAM_LEAD"] },
      },
    }),
    "INVALID_LEAD",
    "Select an active Team Lead or Super Admin.",
  );
  if (old && (input.archived || old.departmentId !== input.departmentId))
    invariant(
      !(await tx.employeeProfile.count({ where: { teamId: old.id } })),
      "TEAM_IN_USE",
      "Move employee profiles before archiving or changing this team’s department.",
      409,
    );
  const data = {
    name: input.name,
    departmentId: input.departmentId,
    leadId: input.leadId,
    archivedAt: input.archived ? new Date() : null,
  };
  const item = old
    ? await tx.team.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      })
    : await tx.team.create({ data });
  await audit(tx, actor.id, old ? "TEAM_UPDATED" : "TEAM_CREATED", item.id, {
    before: old
      ? { leadId: old.leadId, departmentId: old.departmentId, name: old.name }
      : null,
    after: {
      leadId: item.leadId,
      departmentId: item.departmentId,
      name: item.name,
    },
    archived: input.archived,
  });
  return item;
}
export async function employeeDetail(actor: Actor, userId: string) {
  invariant(
    actor.role === "SUPER_ADMIN" || actor.id === userId,
    "FORBIDDEN",
    "Private profile access denied.",
    403,
  );
  invariant(
    await db.person.findUnique({ where: { id: userId } }),
    "NOT_FOUND",
    "Person not found.",
    404,
  );
  return db.employeeProfile.findUnique({ where: { userId } });
}
export async function saveEmployee(
  tx: Tx,
  actor: Actor,
  userId: string,
  input: z.infer<typeof employeeSchema>,
) {
  root(actor);
  await lock(tx);
  invariant(
    await tx.person.findUnique({ where: { id: userId } }),
    "NOT_FOUND",
    "Person not found.",
    404,
  );
  const old = await tx.employeeProfile.findUnique({ where: { userId } });
  expected(old?.version ?? 0, input.expectedVersion);
  if (input.departmentId)
    invariant(
      await tx.department.findFirst({
        where: { id: input.departmentId, archivedAt: null },
      }),
      "INVALID_DEPARTMENT",
      "Select an active department.",
    );
  invariant(
    !input.teamId || input.departmentId,
    "INVALID_TEAM",
    "Select a department before a team.",
  );
  if (input.teamId)
    invariant(
      await tx.team.findFirst({
        where: {
          id: input.teamId,
          departmentId: input.departmentId ?? "",
          archivedAt: null,
        },
      }),
      "INVALID_TEAM",
      "Team must belong to the selected active department.",
    );
  if (input.managerId) {
    invariant(
      await tx.person.findFirst({
        where: { id: input.managerId, status: "ACTIVE" },
      }),
      "INVALID_MANAGER",
      "Select an active manager.",
    );
    let cursor: string | null = input.managerId;
    const visited = new Set<string>([userId]);
    while (cursor) {
      invariant(
        !visited.has(cursor),
        "MANAGER_CYCLE",
        "Manager relationships cannot contain a cycle.",
      );
      visited.add(cursor);
      invariant(
        visited.size <= 1001,
        "MANAGER_DEPTH",
        "Manager chain is too deep.",
      );
      cursor =
        (
          await tx.employeeProfile.findUnique({
            where: { userId: cursor },
            select: { managerId: true },
          })
        )?.managerId ?? null;
    }
  }
  const { expectedVersion: _, ...fields } = input;
  void _;
  const data = {
    ...fields,
    joiningDate: fields.joiningDate ? new Date(fields.joiningDate) : null,
    internshipEndDate: fields.internshipEndDate
      ? new Date(fields.internshipEndDate)
      : null,
  };
  const item = old
    ? await tx.employeeProfile.update({
        where: { userId },
        data: { ...data, version: { increment: 1 } },
      })
    : await tx.employeeProfile.create({ data: { ...data, userId } });
  await audit(tx, actor.id, "EMPLOYEE_PROFILE_UPDATED", userId, {
    before: {
      departmentId: old?.departmentId ?? null,
      teamId: old?.teamId ?? null,
      managerId: old?.managerId ?? null,
    },
    after: {
      departmentId: item.departmentId,
      teamId: item.teamId,
      managerId: item.managerId,
    },
    workMode: item.workMode,
    privateContactChanged: old?.privateContact !== item.privateContact,
  });
  return { userId, version: item.version };
}
