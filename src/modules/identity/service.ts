import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { z } from "zod";
import { db } from "@/server/db";
import { invariant } from "@/server/errors";
import type { Actor } from "@/server/context";
import { audit, type Tx } from "@/server/transaction";
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
      eventKey: `invite:${item.id}`,
      recipient: input.email,
      subject: "Your Encova Workspace invitation",
      text: `Accept your invitation within 72 hours: ${process.env.BETTER_AUTH_URL}/invite/${token}`,
    },
  });
  await audit(tx, actor.id, "INVITATION_CREATED", item.id, {
    email: input.email,
    role: input.role,
  });
  return { id: item.id, email: item.email, expiresAt: item.expiresAt };
}
export async function acceptInvitation(input: z.infer<typeof acceptSchema>) {
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
        emailAndPassword: { enabled: true, minPasswordLength: 12 },
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
        data: { acceptedAt: new Date() },
      });
      await audit(tx, person.id, "INVITATION_ACCEPTED", item.id);
      return { id: person.id };
    },
    { timeout: 30000 },
  );
}
