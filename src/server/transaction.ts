import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { Prisma } from "@/generated/prisma/client";
import { AppError, invariant } from "./errors";
import type { Actor } from "./context";
export type Tx = Prisma.TransactionClient;
export async function mutate(
  actor: Actor,
  operation: string,
  key: string | null,
  body: unknown,
  fn: (tx: Tx) => Promise<unknown>,
) {
  invariant(
    key && key.length >= 8 && key.length <= 128,
    "IDEMPOTENCY_REQUIRED",
    "Provide an Idempotency-Key of 8–128 characters.",
    400,
  );
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          // Per-actor serialization makes domain writes and idempotency reservation atomic.
          await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${actor.id}::uuid FOR UPDATE`;
          const current = await tx.person.findUnique({
            where: { id: actor.id },
          });
          invariant(
            current?.status === "ACTIVE",
            "ACCOUNT_INACTIVE",
            "This account is not active.",
            403,
          );
          invariant(
            current.role === actor.role,
            "PERMISSIONS_CHANGED",
            "Permissions changed; reload and retry.",
            409,
          );
          const previous = await tx.idempotency.findUnique({
            where: {
              actorId_operation_key: { actorId: actor.id, operation, key },
            },
          });
          if (previous) {
            invariant(
              previous.actorRole === actor.role,
              "PERMISSIONS_CHANGED",
              "Permissions changed; use a fresh action.",
              409,
            );
            invariant(
              previous.hash === hash,
              "IDEMPOTENCY_CONFLICT",
              "This key was used with different input.",
              409,
            );
            return previous.result;
          }
          const result = JSON.parse(
            JSON.stringify(await fn(tx)),
          ) as Prisma.InputJsonValue;
          await tx.idempotency.create({
            data: {
              actorId: actor.id,
              actorRole: actor.role,
              operation,
              key,
              hash,
              result,
              expiresAt: new Date(Date.now() + 86400000),
            },
          });
          return result;
        },
        {
          maxWait: 10000,
          timeout: 15000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      const failure = error as {
        code?: string;
        meta?: {
          code?: string;
          driverAdapterError?: { cause?: { originalCode?: string } };
        };
      };
      const sqlCode =
        failure.meta?.code ??
        failure.meta?.driverAdapterError?.cause?.originalCode;
      const retryable =
        ["P2034", "P2002"].includes(failure.code ?? "") ||
        (failure.code === "P2010" &&
          ["40001", "40P01"].includes(String(sqlCode)));
      if (retryable && attempt < 2) continue;
      if (retryable && failure.code !== "P2002")
        throw new AppError(
          "CONCURRENT_CHANGE",
          "Concurrent change; retry.",
          409,
        );
      if (failure.code === "P2002")
        throw new AppError("DUPLICATE", "This record already exists.", 409);
      throw error;
    }
  }
}
export async function audit(
  tx: Tx,
  actorId: string | null,
  action: string,
  entityId: string,
  changes: Prisma.InputJsonValue = {},
) {
  await tx.audit.create({
    data: {
      actorId,
      action,
      entityId,
      changes,
      requestId: crypto.randomUUID(),
    },
  });
}
export function expected(actual: number, wanted: number) {
  invariant(
    actual === wanted,
    "STALE_VERSION",
    "This record changed. Reload before trying again.",
    409,
  );
}
