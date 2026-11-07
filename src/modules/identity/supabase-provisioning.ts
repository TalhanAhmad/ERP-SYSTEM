import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { acceptSchema } from "./schemas";
import { db } from "@/server/db";
import { audit } from "@/server/transaction";
import { invariant } from "@/server/errors";
import {
  supabaseIdentity,
  type IdentityGateway,
} from "@/server/supabase/provision";
export async function acceptSupabaseInvitation(
  input: z.infer<typeof acceptSchema>,
  identity: IdentityGateway = supabaseIdentity,
) {
  const hash = createHash("sha256").update(input.token).digest("hex"),
    attemptId = crypto.randomUUID();
  const claimed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invitation" WHERE "tokenHash"=${hash} FOR UPDATE`;
    const item = await tx.invitation.findUnique({ where: { tokenHash: hash } });
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
    invariant(
      !item.provisioningLeaseUntil || item.provisioningLeaseUntil <= new Date(),
      "PROVISIONING_BUSY",
      "This invitation is being processed. Retry shortly.",
      409,
    );
    invariant(
      !(await tx.person.findFirst({
        where: { OR: [{ email: item.email }, { username: item.username }] },
      })),
      "IDENTITY_CONFLICT",
      "This account requires administrator reconciliation.",
      409,
    );
    await tx.$executeRaw`UPDATE "Invitation" SET "provisioningStatus"='PROVISIONING',"provisioningAttemptId"=${attemptId}::uuid,"provisioningLeaseUntil"=now()+interval '2 minutes' WHERE id=${item.id}::uuid`;
    return item;
  });
  try {
    // Supabase Auth has its own transaction boundary. Never make this HTTP call
    // inside a PostgreSQL transaction, or grant access before the domain commit.
    const user = await identity.provision({
      email: claimed.email,
      password: input.password,
      displayName: claimed.displayName,
      invitationId: claimed.id,
    });
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id=${claimed.id}::uuid FOR UPDATE`;
      const item = await tx.invitation.findUniqueOrThrow({
        where: { id: claimed.id },
      });
      invariant(
        item.provisioningAttemptId === attemptId &&
          item.tokenHash === hash &&
          !item.acceptedAt &&
          !item.revokedAt &&
          item.expiresAt > new Date(),
        "INVALID_INVITATION",
        "Invitation is no longer available.",
        409,
      );
      const person = await tx.person.create({
        data: {
          supabaseUserId: user.id,
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
        data: {
          acceptedAt: new Date(),
          version: { increment: 1 },
          provisioningStatus: "COMPLETE",
          provisioningLeaseUntil: null,
        },
      });
      await audit(tx, person.id, "INVITATION_ACCEPTED", item.id, {
        provider: "supabase",
      });
      await tx.outbox.updateMany({
        where: { invitationId: item.id, deliveredAt: null, canceledAt: null },
        data: { canceledAt: new Date() },
      });
      return { id: person.id };
    });
  } catch (error) {
    await db.invitation.updateMany({
      where: {
        id: claimed.id,
        provisioningAttemptId: attemptId,
        acceptedAt: null,
      },
      data: { provisioningStatus: "PENDING", provisioningLeaseUntil: null },
    });
    // An orphan provider identity remains denied by context(); its invitation
    // provenance allows a safe retry. Never link an unrelated existing identity.
    throw error;
  }
}
