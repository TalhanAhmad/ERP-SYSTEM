import { z } from "zod";
import { reasonSchema, versionSchema } from "../accounting/schemas";
const evidence = z.string().trim().min(3).max(1000);
export const closeReportTypes = [
  "TRIAL_BALANCE",
  "PROFIT_LOSS",
  "BALANCE_SHEET",
] as const;
export const closeSchemas = {
  CLOSE: z
    .object({
      expectedVersion: versionSchema,
      basisHash: z.string().regex(/^[0-9a-f]{64}$/),
      postingFailuresReviewed: z.literal(true),
      pendingAdjustmentsReviewed: z.literal(true),
      postingReviewEvidence: evidence,
      adjustmentReviewEvidence: evidence,
      reason: reasonSchema,
    })
    .strict(),
  REOPEN: z
    .object({
      closeId: z.uuid(),
      expectedVersion: versionSchema,
      expectedCloseVersion: versionSchema,
      reason: reasonSchema,
    })
    .strict(),
  EXPORT: z
    .object({ reportType: z.enum(closeReportTypes), reason: reasonSchema })
    .strict(),
  ISSUE_CREATE: z
    .object({
      kind: z.enum(["POSTING_FAILURE", "PENDING_ADJUSTMENT"]),
      description: z.string().trim().min(3).max(500),
      evidence,
      reason: reasonSchema,
    })
    .strict(),
  ISSUE_RESOLVE: z
    .object({
      expectedVersion: versionSchema,
      resolution: evidence,
      reason: reasonSchema,
    })
    .strict(),
};
export type CloseAction = keyof typeof closeSchemas;
export const closeQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
