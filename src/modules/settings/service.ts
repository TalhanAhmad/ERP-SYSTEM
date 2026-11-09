import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { audit, expected, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
export const settingsSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    companyName: z.string().trim().min(1).max(120),
    timezone: z.literal("Asia/Karachi"),
    workweek: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    reportCutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    reportReminders: z.boolean(),
    confirmPolicies: z.boolean(),
  })
  .strict();
export async function companySettings() {
  return db.companySettings.findUniqueOrThrow({ where: { id: "workspace" } });
}
export async function saveSettings(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof settingsSchema>,
) {
  invariant(
    actor.role === "SUPER_ADMIN",
    "FORBIDDEN",
    "Super Admin access required.",
    403,
  );
  await tx.$queryRaw`SELECT id FROM "CompanySettings" WHERE id='workspace' FOR UPDATE`;
  const old = await tx.companySettings.findUniqueOrThrow({
    where: { id: "workspace" },
  });
  expected(old.version, input.expectedVersion);
  const { expectedVersion: _, confirmPolicies, ...data } = input;
  void _;
  const item = await tx.companySettings.update({
    where: { id: "workspace" },
    data: {
      ...data,
      policyConfirmedAt: confirmPolicies ? new Date() : null,
      version: { increment: 1 },
    },
  });
  await audit(tx, actor.id, "SETTINGS_UPDATED", "workspace", {
    before: {
      companyName: old.companyName,
      reportCutoff: old.reportCutoff,
      workweek: old.workweek,
      reportReminders: old.reportReminders,
    },
    after: {
      companyName: item.companyName,
      reportCutoff: item.reportCutoff,
      workweek: item.workweek,
      reportReminders: item.reportReminders,
    },
    policiesConfirmed: confirmPolicies,
  });
  return item;
}
