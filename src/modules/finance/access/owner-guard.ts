import "server-only";
import { env } from "@/server/env";
import { invariant } from "@/server/errors";
import type { Tx } from "@/server/transaction";

export async function protectFinanceOwner(tx: Tx, personId: string) {
  // Older live schemas have no finance tables while the feature is disabled.
  // Migration 19's database trigger protects an owner even with the flag off.
  if (!env.FINANCE_ENABLED) return;
  invariant(
    !(await tx.financeSettings.findFirst({ where: { ownerId: personId } })),
    "FINANCE_OWNER_PROTECTED",
    "Transfer finance ownership before changing this account's access.",
    409,
  );
}
