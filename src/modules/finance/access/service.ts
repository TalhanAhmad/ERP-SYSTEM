import "server-only";
import { db } from "@/server/db";
import { AppError, invariant } from "@/server/errors";
import type { Actor } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { requireFinanceEnabled, withFinanceAccess } from "./policy";
import { consumeFinanceProof, type FinanceProof } from "./reauth";
import type { AccessAction } from "./schemas";

const errors: Record<string, [number, string]> = {
  FINANCE_FORBIDDEN: [403, "Finance access is unavailable."],
  FINANCE_OWNER_REQUIRED: [
    403,
    "Only the current Finance Owner can change access.",
  ],
  FINANCE_OWNER_PROTECTED: [
    409,
    "Transfer finance ownership before changing this account's access.",
  ],
  FINANCE_SETUP_REQUIRED: [409, "Finance ownership has not been set up."],
  FINANCE_OWNER_EXISTS: [
    409,
    "A Finance Owner already exists. Use the transfer workflow.",
  ],
  FINANCE_TARGET_INELIGIBLE: [
    422,
    "Choose another active Super Admin with the required access.",
  ],
  FINANCE_ALREADY_GRANTED: [
    409,
    "This administrator already has finance access.",
  ],
  FINANCE_STALE_VERSION: [
    409,
    "This record changed. Reload before trying again.",
  ],
  FINANCE_TRANSFER_PENDING: [
    409,
    "Cancel the pending transfer before starting another.",
  ],
  FINANCE_TRANSFER_INVALID: [
    409,
    "This transfer changed, expired or is no longer available.",
  ],
  FINANCE_NOT_FOUND: [404, "Record unavailable."],
  FINANCE_IDEMPOTENCY_CONFLICT: [
    409,
    "This request key was already used for different input.",
  ],
  FINANCE_REAUTH_REQUIRED: [
    403,
    "Verify your password and authenticator again.",
  ],
  FINANCE_INVALID_INPUT: [422, "Check the supplied values."],
};
async function databaseCommand<T>(command: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await command();
    } catch (error) {
      const detail = error as {
        code?: string;
        meta?: {
          driverAdapterError?: {
            cause?: { originalCode?: string; originalMessage?: string };
          };
        };
      };
      const cause = detail.meta?.driverAdapterError?.cause;
      if (["40001", "40P01"].includes(cause?.originalCode ?? "") && attempt < 2)
        continue;
      const code = Object.keys(errors).find(
        (code) => cause?.originalMessage === code,
      );
      if (code) throw new AppError(code, errors[code][1], errors[code][0]);
      throw error;
    }
  }
  throw new AppError("CONCURRENT_CHANGE", "Concurrent change; retry.", 409);
}
export async function accessCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: AccessAction,
  input: Prisma.InputJsonObject,
  key: string | null,
  requestId = crypto.randomUUID(),
) {
  requireFinanceEnabled();
  invariant(
    key && key.length >= 8 && key.length <= 128,
    "IDEMPOTENCY_REQUIRED",
    "Provide an Idempotency-Key of 8–128 characters.",
    400,
  );
  const evidence = consumeFinanceProof(proof, actor.id, `${action}:${key}`);
  const rows = await databaseCommand(
    () => db.$queryRaw<{ result: { id: string; version: number } }[]>`
    SELECT public.encova_finance_access_command(${actor.id}::uuid,${evidence.provider},${evidence.sessionId},${evidence.verifiedAt}::timestamptz,
    ${action},${JSON.stringify(input)}::jsonb,${key},${requestId}::uuid) AS result
  `,
  );
  return rows[0].result;
}
export async function setupOwner(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  username: string,
  reason: string,
  recoveryEvidence: string | null = null,
) {
  requireFinanceEnabled();
  const evidence = consumeFinanceProof(proof, actor.id, "operator-owner-setup");
  const rows = await databaseCommand(
    () => db.$queryRaw<{ result: { ownerId: string } }[]>`
    SELECT public.encova_finance_setup_owner(${actor.id}::uuid,${evidence.provider},${evidence.sessionId},${evidence.verifiedAt}::timestamptz,
    ${username},${reason},${crypto.randomUUID()}::uuid,${recoveryEvidence}) AS result
  `,
  );
  return rows[0].result;
}
export async function financeAccessSnapshot(actor: Pick<Actor, "id">) {
  return withFinanceAccess(actor, async (tx) => {
    const settings = await tx.financeSettings.findFirst({
      select: {
        version: true,
        ownerId: true,
        owner: { select: { displayName: true, username: true } },
      },
    });
    const canManage = settings?.ownerId === actor.id;
    const grants = await tx.financeGrant.findMany({
      where: { revokedAt: null, ...(!canManage ? { userId: actor.id } : {}) },
      select: {
        id: true,
        userId: true,
        version: true,
        grantedAt: true,
        user: {
          select: {
            displayName: true,
            username: true,
            status: true,
            role: true,
          },
        },
      },
      orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
    });
    const transfers = await tx.financeOwnershipTransfer.findMany({
      where: {
        status: "PENDING",
        expiresAt: { gt: new Date() },
        ...(!canManage ? { targetOwnerId: actor.id } : {}),
      },
      select: {
        id: true,
        currentOwnerId: true,
        targetOwnerId: true,
        version: true,
        expiresAt: true,
      },
      take: 1,
    });
    const eligible = canManage
      ? await tx.person.findMany({
          where: {
            role: "SUPER_ADMIN",
            status: "ACTIVE",
            id: { not: actor.id },
          },
          select: { id: true, displayName: true, username: true },
          orderBy: [{ username: "asc" }, { id: "asc" }],
          take: 100,
        })
      : [];
    const history = await tx.financeAuditEvent.findMany({
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        actor: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25,
    });
    return {
      settings,
      canManage: Boolean(canManage),
      grants,
      transfers,
      eligible,
      history,
      actorId: actor.id,
    };
  });
}
