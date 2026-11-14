import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../../accounting/schemas";
import { pkrAmountSchema } from "../../accounting/money";
export const monthSchema = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])(?![\s\S])/)
  .refine((v) => v >= "0001-01");
const optionalId = z.uuid().nullable().default(null),
  review = z.string().trim().min(3).max(1000);
const body = z
  .object({
    postingDate: accountingDateSchema,
    description: review,
    evidence: review,
    approvalEvidence: review,
    amount: pkrAmountSchema,
    feeAmount: pkrAmountSchema.default("0.00"),
    expenseAccountId: optionalId,
    accumulatedAccountId: optionalId,
    counterAccountId: optionalId,
    cashAccountId: optionalId,
    gainAccountId: optionalId,
    lossAccountId: optionalId,
    feeAccountId: optionalId,
    newResidual: pkrAmountSchema.nullable().default(null),
    newLifeMonths: z.number().int().min(1).max(1200).nullable().default(null),
    newFirstMonth: monthSchema.nullable().default(null),
    reason: reasonSchema,
  })
  .strict();
export const assetMovementSchemas = {
  CREATE: body.extend({
    assetId: z.uuid(),
    kind: z.enum([
      "IMPAIRMENT",
      "ADJUSTMENT_INCREASE",
      "ADJUSTMENT_DECREASE",
      "DISPOSAL",
      "POLICY_CHANGE",
    ]),
  }),
  GENERATE: z
    .object({
      assetId: z.uuid(),
      month: monthSchema,
      postingDate: accountingDateSchema,
      expenseAccountId: z.uuid(),
      accumulatedAccountId: z.uuid(),
      evidence: review,
      approvalEvidence: review,
      reason: reasonSchema,
    })
    .strict(),
  UPDATE: body.extend({ expectedVersion: versionSchema }),
  REFRESH: versionReasonSchema,
  REOPEN: versionReasonSchema,
  POST: versionReasonSchema,
  VOID: versionReasonSchema,
  REVERSE: versionReasonSchema.extend({ postingDate: accountingDateSchema }),
};
export type AssetMovementAction = keyof typeof assetMovementSchemas;
export const assetMovementQuerySchema = z
  .object({
    assetId: z.uuid().optional(),
    q: z.string().trim().max(100).default(""),
    state: z
      .enum(["ALL", "DRAFT", "POSTED", "VOIDED", "REVERSED"])
      .default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
