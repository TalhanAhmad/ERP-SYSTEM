import "server-only";
import { z } from "zod";
import { env } from "@/server/env";
import type { Actor } from "@/server/context";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
export const roleSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    role: z.enum(["SUPER_ADMIN", "HR_ADMIN", "TEAM_LEAD", "MEMBER"]),
  })
  .strict();
export async function changeRole(
  tx: Tx,
  actor: Actor,
  id: string,
  input: z.infer<typeof roleSchema>,
) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Only super admins can change roles.",
    403,
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(987661)::text`;
  const target = await tx.person.findUnique({ where: { id } });
  invariant(target, "NOT_FOUND", "Person not found.", 404);
  expected(target.version, input.expectedVersion);
  if (
    target.role === "SUPER_ADMIN" &&
    target.status === "ACTIVE" &&
    input.role !== "SUPER_ADMIN"
  )
    invariant(
      (await tx.person.count({
        where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      })) > 1,
      "LAST_ADMIN",
      "At least one active super admin is required.",
      409,
    );
  invariant(
    actor.id !== id,
    "SELF_ROLE_CHANGE",
    "Ask another super admin to change your role.",
    403,
  );
  const updated = await tx.person.update({
    where: { id },
    data: { role: input.role, version: { increment: 1 } },
  });
  if (target.authUserId && env.AUTH_PROVIDER === "better-auth")
    await tx.session.deleteMany({ where: { userId: target.authUserId } });
  await audit(tx, actor.id, "ROLE_CHANGED", id, {
    from: target.role,
    to: input.role,
  });
  return { id: updated.id, role: updated.role, version: updated.version };
}
export async function deactivate(
  tx: Tx,
  actor: Actor,
  id: string,
  input: { expectedVersion: number },
) {
  invariant(
    ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role),
    "FORBIDDEN",
    "HR or super admin access required.",
    403,
  );
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(987661)::text`;
  const target = await tx.person.findUnique({ where: { id } });
  invariant(target, "NOT_FOUND", "Person not found.", 404);
  expected(target.version, input.expectedVersion);
  invariant(
    actor.role === "SUPER_ADMIN" || target.role === "MEMBER",
    "FORBIDDEN",
    "HR can deactivate ordinary members only.",
    403,
  );
  if (target.role === "SUPER_ADMIN" && target.status === "ACTIVE")
    invariant(
      (await tx.person.count({
        where: { role: "SUPER_ADMIN", status: "ACTIVE" },
      })) > 1,
      "LAST_ADMIN",
      "At least one active super admin is required.",
      409,
    );
  invariant(
    actor.id !== id,
    "SELF_DEACTIVATION",
    "Ask another administrator to deactivate your account.",
    403,
  );
  const updated = await tx.person.update({
    where: { id },
    data: { status: "INACTIVE", version: { increment: 1 } },
  });
  if (target.authUserId && env.AUTH_PROVIDER === "better-auth")
    await tx.session.deleteMany({ where: { userId: target.authUserId } });
  const assigned = await tx.task.count({
    where: { assigneeId: id, status: { notIn: ["APPROVED", "CANCELED"] } },
  });
  await audit(tx, actor.id, "PERSON_DEACTIVATED", id, {
    openAssignments: assigned,
  });
  return { id: updated.id, status: updated.status, openAssignments: assigned };
}
