import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, invariant } from "@/server/errors";

type FinanceActor = Pick<Actor, "id">;
const deny = () =>
  new AppError("FINANCE_FORBIDDEN", "Finance access is unavailable.", 403);

export function requireFinanceEnabled() {
  invariant(env.FINANCE_ENABLED, "NOT_FOUND", "Not found.", 404);
}

// Every finance service, including workers, must run its query in this callback.
// Never authorize from a role supplied by the caller or a cached grant/DTO.
// Person -> per-person finance advisory lock is the lock order. Future grant
// management must take the exclusive advisory lock before changing grants.
export async function withFinanceAccess<T>(
  actor: FinanceActor,
  query: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  requireFinanceEnabled();
  return db.$transaction(
    async (tx) => {
      await requireFinanceAccess(tx, actor);
      return query(tx);
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

// For a caller that already owns a transaction (for example the future posting
// engine). The protected query must use this same transaction, never global db.
export async function requireFinanceAccess(
  tx: Prisma.TransactionClient,
  actor: FinanceActor,
) {
  requireFinanceEnabled();
  const people = await tx.$queryRaw<{ role: string; status: string }[]>`
      SELECT "role", "status" FROM "Person" WHERE id=${actor.id}::uuid FOR SHARE
    `;
  if (people[0]?.status !== "ACTIVE" || people[0]?.role !== "SUPER_ADMIN")
    throw deny();
  // Grant rows remain SELECT-only for the runtime role. A row FOR SHARE lock
  // would require UPDATE privilege, so use a transaction-scoped advisory lock.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock_shared(629813, hashtext(${actor.id}))`;
  const grants = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "FinanceGrant" WHERE "userId"=${actor.id}::uuid
      AND "revokedAt" IS NULL
    `;
  if (grants.length !== 1) throw deny();
}

export async function hasFinanceAccess(actor: FinanceActor) {
  if (!env.FINANCE_ENABLED) return false;
  try {
    await withFinanceAccess(actor, async () => undefined);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === "FINANCE_FORBIDDEN")
      return false;
    throw error;
  }
}

// A minimal capability DTO, not a ledger or a launch/readiness assertion.
export async function financeStatus(actor: FinanceActor) {
  return withFinanceAccess(actor, async () => ({
    currency: "PKR" as const,
    stage: "ACCESS_FOUNDATION" as const,
  }));
}
