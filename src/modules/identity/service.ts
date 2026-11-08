import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { acceptSupabaseInvitation } from "./supabase-provisioning";
import { invariant } from "@/server/errors";
import type { Actor } from "@/server/context";
import { audit, expected, type Tx } from "@/server/transaction";
import { invitationSchema, acceptSchema } from "./schemas";
export { invitationSchema, acceptSchema } from "./schemas";
export async function invite(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof invitationSchema>,
) {
  invariant(
    actor.role === "SUPER_ADMIN" ||
      (actor.role === "HR_ADMIN" && input.role === "MEMBER"),
    "FORBIDDEN",
    "You cannot invite this role.",
    403,
  );
  invariant(
    !(await tx.person.findFirst({
      where: { OR: [{ email: input.email }, { username: input.username }] },
    })),
    "DUPLICATE",
    "Email or username already exists.",
    409,
  );
  const token = randomBytes(32).toString("hex");
  const item = await tx.invitation.create({
    data: {
      ...input,
      invitedBy: actor.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 72 * 3600000),
    },
  });
  await tx.outbox.create({
    data: {
      invitationId: item.id,
      eventKey: `invite:${item.id}`,
      recipient: input.email,
      subject: "Your Encova Workspace invitation",
      text: `Accept your invitation within 72 hours: ${env.APP_URL}/invite/${token}`,
    },
  });
  await audit(tx, actor.id, "INVITATION_CREATED", item.id, {
    email: input.email,
    role: input.role,
  });
  return { id: item.id, email: item.email, expiresAt: item.expiresAt };
}
function manageInvitation(actor: Actor, role: string) {
  invariant(
    actor.role === "SUPER_ADMIN" ||
      (actor.role === "HR_ADMIN" && role === "MEMBER"),
    "FORBIDDEN",
    "You cannot manage this invitation.",
    403,
  );
}
// Explicit DTO: token hashes, bearer links and provider provisioning IDs stay server-only.
export async function listInvitations(actor: Actor) {
  invariant(
    ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role),
    "FORBIDDEN",
    "Administrator access required.",
    403,
  );
  const items = await db.invitation.findMany({
    where: actor.role === "HR_ADMIN" ? { role: "MEMBER" } : {},
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      role: true,
      employmentType: true,
      version: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
      provisioningStatus: true,
      emails: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          deliveredAt: true,
          canceledAt: true,
          attempts: true,
          lastError: true,
        },
      },
    },
  });
  return items.map(({ emails, provisioningStatus, ...item }) => ({
    ...item,
    status: item.acceptedAt
      ? "ACCEPTED"
      : item.revokedAt
        ? "REVOKED"
        : item.expiresAt <= new Date()
          ? "EXPIRED"
          : "PENDING",
    processing: provisioningStatus === "PROVISIONING",
    delivery: emails[0]?.canceledAt
      ? "CANCELED"
      : emails[0]?.deliveredAt
        ? "SMTP_ACCEPTED"
        : emails[0]?.lastError
          ? emails[0].attempts >= 5
            ? "FAILED"
            : "RETRYING"
          : "QUEUED",
  }));
}
export async function manageInvitationAction(
  tx: Tx,
  actor: Actor,
  id: string,
  input: { expectedVersion: number; action: "resend" | "revoke" },
) {
  await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id=${id}::uuid FOR UPDATE`;
  const item = await tx.invitation.findUnique({ where: { id } });
  invariant(item, "NOT_FOUND", "Invitation not found.", 404);
  manageInvitation(actor, item.role);
  expected(item.version, input.expectedVersion);
  invariant(
    !item.acceptedAt && !item.revokedAt,
    "INVITATION_CLOSED",
    "This invitation has already been accepted or revoked.",
    409,
  );
  if (input.action === "resend")
    invariant(
      item.provisioningStatus === "PENDING",
      "PROVISIONING_BUSY",
      "This invitation is being processed. Revoke it or retry after processing finishes.",
      409,
    );
  // Canceled queued mail is never claimed by a worker. Already in-flight mail
  // may arrive, but the revoked/rotated token cannot authorize acceptance.
  await tx.outbox.updateMany({
    where: { invitationId: id, deliveredAt: null, canceledAt: null },
    data: { canceledAt: new Date() },
  });
  if (input.action === "revoke") {
    const updated = await tx.invitation.update({
      where: { id },
      data: { revokedAt: new Date(), version: { increment: 1 } },
    });
    await audit(tx, actor.id, "INVITATION_REVOKED", id);
    return { id, version: updated.version, status: "REVOKED" };
  }
  const token = randomBytes(32).toString("hex");
  const updated = await tx.invitation.update({
    where: { id },
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 72 * 3600000),
      version: { increment: 1 },
      provisioningAttemptId: null,
      provisioningLeaseUntil: null,
    },
  });
  await tx.outbox.create({
    data: {
      invitationId: id,
      eventKey: `invite:${id}:resend:${updated.version}`,
      recipient: item.email,
      subject: "Your new Encova Workspace invitation",
      text: `Accept your invitation within 72 hours: ${env.APP_URL}/invite/${token}`,
    },
  });
  await audit(tx, actor.id, "INVITATION_RESENT", id, {
    version: updated.version,
  });
  return {
    id,
    version: updated.version,
    expiresAt: updated.expiresAt,
    status: "PENDING",
  };
}
export async function acceptInvitation(input: z.infer<typeof acceptSchema>) {
  if (env.AUTH_PROVIDER === "supabase") return acceptSupabaseInvitation(input);
  const hash = createHash("sha256").update(input.token).digest("hex");
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE "tokenHash"=${hash} FOR UPDATE`;
      const item = await tx.invitation.findUnique({
        where: { tokenHash: hash },
      });
      invariant(
        item &&
          !item.acceptedAt &&
          !item.revokedAt &&
          item.expiresAt > new Date() &&
          item.email === input.email,
        "INVALID_INVITATION",
        "Invitation is invalid, expired, used, or does not match this email.",
        422,
      );
      const provisioning = betterAuth({
        database: prismaAdapter(tx as unknown as typeof db, {
          provider: "postgresql",
        }),
        secret: process.env.BETTER_AUTH_SECRET,
        emailAndPassword: {
          enabled: true,
          minPasswordLength: MIN_PASSWORD_LENGTH,
        },
        advanced: { database: { generateId: () => crypto.randomUUID() } },
      });
      const identity = await provisioning.api.signUpEmail({
        body: {
          email: item.email,
          name: item.displayName,
          password: input.password,
        },
      });
      // Possession of a single-use emailed token verifies ownership of this exact email.
      await tx.user.update({
        where: { id: identity.user.id },
        data: { emailVerified: true },
      });
      const person = await tx.person.create({
        data: {
          authUserId: identity.user.id,
          email: item.email,
          username: item.username,
          displayName: item.displayName,
          role: item.role,
          employmentType: item.employmentType,
          status: "ACTIVE",
        },
      });
      await tx.invitation.update({
        where: { id: item.id },
        data: { acceptedAt: new Date(), version: { increment: 1 } },
      });
      await tx.outbox.updateMany({
        where: { invitationId: item.id, deliveredAt: null, canceledAt: null },
        data: { canceledAt: new Date() },
      });
      await audit(tx, person.id, "INVITATION_ACCEPTED", item.id);
      return { id: person.id };
    },
    { timeout: 30000 },
  );
}
