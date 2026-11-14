import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../accounting/schemas";
import { pkrAmountSchema } from "../accounting/money";
const text = z.string().trim().min(3).max(1000),
  positive = pkrAmountSchema.refine(
    (v) => v !== "0.00",
    "Enter a positive amount.",
  );
const profile = z
  .object({
    clientId: z.uuid(),
    originalContract: pkrAmountSchema,
    billingModel: z.enum([
      "FIXED_PRICE",
      "TIME_BASED",
      "RETAINER",
      "MILESTONE",
    ]),
    terms: text,
    evidence: text,
    reason: reasonSchema,
  })
  .strict();
const variation = z
  .object({
    direction: z.enum(["INCREASE", "DECREASE"]),
    amount: positive,
    reference: z.string().trim().min(1).max(80),
    description: text,
    signedDate: accountingDateSchema,
    evidence: text,
    reason: reasonSchema,
  })
  .strict();
const milestone = z
  .object({
    description: text,
    amount: positive,
    expectedDate: accountingDateSchema,
    dueDate: accountingDateSchema,
    evidence: text,
    reason: reasonSchema,
  })
  .strict()
  .refine((v) => v.dueDate >= v.expectedDate, {
    path: ["dueDate"],
    message: "Due date cannot precede expected billing date.",
  });
export const projectSchemas = {
  PROFILE_CREATE: profile.extend({ projectId: z.uuid() }),
  PROFILE_UPDATE: profile.extend({ expectedVersion: versionSchema }),
  PROFILE_ACTIVATE: versionReasonSchema.extend({
    signedDate: accountingDateSchema,
    approvalEvidence: text,
  }),
  PROFILE_CLOSE: versionReasonSchema,
  PROFILE_REOPEN: versionReasonSchema,
  PROFILE_CANCEL: versionReasonSchema,
  VARIATION_CREATE: variation.extend({ projectId: z.uuid() }),
  VARIATION_UPDATE: variation.extend({ expectedVersion: versionSchema }),
  VARIATION_APPROVE: versionReasonSchema.extend({ approvalEvidence: text }),
  VARIATION_VOID: versionReasonSchema,
  MILESTONE_CREATE: milestone.safeExtend({ projectId: z.uuid() }),
  MILESTONE_UPDATE: milestone.safeExtend({ expectedVersion: versionSchema }),
  MILESTONE_CONFIRM: versionReasonSchema.extend({ approvalEvidence: text }),
  MILESTONE_CANCEL: versionReasonSchema,
  LINK_CREATE: z
    .object({
      milestoneId: z.uuid(),
      invoiceLineId: z.uuid(),
      reason: reasonSchema,
    })
    .strict(),
  LINK_RELEASE: versionReasonSchema,
};
export type ProjectFinanceAction = keyof typeof projectSchemas;
export const projectQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z
      .enum(["ALL", "DRAFT", "ACTIVE", "CLOSED", "CANCELLED"])
      .default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export const commercialChildQuerySchema = z
  .object({
    projectId: z.uuid().optional(),
    q: z.string().trim().max(100).default(""),
    state: z
      .enum(["ALL", "DRAFT", "APPROVED", "VOIDED", "CONFIRMED", "CANCELLED"])
      .default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export const commercialOptionSchema = z
  .object({
    kind: z.enum(["PROJECT", "CLIENT", "INVOICE_LINE"]),
    projectId: z.uuid().optional(),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine((v) => v.kind !== "INVOICE_LINE" || !!v.projectId, {
    path: ["projectId"],
    message: "Select the commercial project first.",
  });
