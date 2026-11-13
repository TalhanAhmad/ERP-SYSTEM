import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../accounting/schemas";
import { pkrAmountSchema } from "../accounting/money";
export const movementDraftSchema = z
  .object({
    kind: z.literal("TRANSFER"),
    reference: z.string().trim().min(1).max(80),
    documentDate: accountingDateSchema,
    postingDate: accountingDateSchema,
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    currency: z.literal("PKR").default("PKR"),
    amount: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Amount must be positive.",
    ),
    fromCashId: z.uuid(),
    toCashId: z.uuid(),
    partyId: z.null().default(null),
    controlAccountId: z.null().default(null),
    counterAccountId: z.null().default(null),
    projectId: z.null().default(null),
    approvalEvidence: z.null().default(null),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.fromCashId === d.toCashId)
      c.addIssue({
        code: "custom",
        path: ["toCashId"],
        message: "Choose two different bank/cash accounts.",
      });
    if (d.postingDate < d.documentDate)
      c.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede document date.",
      });
  });
const action = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const movementSchemas = {
  CREATE: movementDraftSchema,
  UPDATE: movementDraftSchema.safeExtend({ expectedVersion: versionSchema }),
  POST: action,
  VOID: action,
  REVERSE: action.safeExtend({ postingDate: accountingDateSchema }),
};
export type MovementAction = keyof typeof movementSchemas;
export const movementQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    kind: z.enum(["ALL", "TRANSFER", "REVERSAL"]).default("ALL"),
    state: z
      .enum(["ALL", "DRAFT", "POSTED", "REVERSED", "VOIDED"])
      .default("ALL"),
    from: accountingDateSchema.optional(),
    to: accountingDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    "End cannot precede start.",
  );
export const cashQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    cashAccountId: z.uuid().optional(),
    from: accountingDateSchema.optional(),
    to: accountingDateSchema.optional(),
    includeInternal: z.enum(["YES", "NO"]).default("YES"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    "End cannot precede start.",
  );
