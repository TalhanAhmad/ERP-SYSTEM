import { z } from "zod";
import { pkrAmountSchema } from "../accounting/money";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../accounting/schemas";
import { monthSchema } from "../assets/lifecycle/schemas";
const note = z.string().trim().min(3).max(1000);
const line = z
  .object({ accountId: z.uuid(), amount: pkrAmountSchema })
  .strict();
const budget = z
  .object({
    description: note,
    evidence: note,
    lines: z
      .array(line)
      .min(1)
      .max(100)
      .refine(
        (v) => new Set(v.map((l) => l.accountId)).size === v.length,
        "Use one budget line per expense account.",
      ),
    reason: reasonSchema,
  })
  .strict();
const forecast = z
  .object({
    kind: z.enum(["RECEIPT", "PAYMENT"]),
    expectedDate: accountingDateSchema,
    amount: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Forecast amount must be positive.",
    ),
    projectId: z.uuid().nullable(),
    partyId: z.uuid().nullable(),
    likelihood: z.enum(["POSSIBLE", "LIKELY", "COMMITTED"]),
    likelihoodNote: note,
    description: note,
    evidence: note,
    reason: reasonSchema,
  })
  .strict();
export const planningSchemas = {
  BUDGET_CREATE: budget
    .extend({
      month: monthSchema,
      projectId: z.uuid().nullable(),
      previousId: z.uuid().nullable().default(null),
      previousVersion: versionSchema.nullable().default(null),
    })
    .refine(
      (v) => (v.previousId !== null) === (v.previousVersion !== null),
      "Select the current approved revision and its version together.",
    ),
  BUDGET_UPDATE: budget.extend({ expectedVersion: versionSchema }),
  BUDGET_APPROVE: versionReasonSchema.extend({ approvalEvidence: note }),
  BUDGET_VOID: versionReasonSchema,
  FORECAST_CREATE: forecast,
  FORECAST_UPDATE: forecast.extend({ expectedVersion: versionSchema }),
  FORECAST_CANCEL: versionReasonSchema,
  FORECAST_REOPEN: versionReasonSchema,
};
export type PlanningAction = keyof typeof planningSchemas;
const page = z.coerce.number().int().min(1).max(10000).default(1);
export const budgetQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    page,
    month: z.preprocess(
      (v) => (v === "" ? undefined : v),
      monthSchema.optional(),
    ),
    projectId: z.union([z.uuid(), z.literal("SHARED")]).optional(),
    state: z
      .enum(["ALL", "DRAFT", "APPROVED", "SUPERSEDED", "VOIDED"])
      .default("ALL"),
  })
  .strict();
export const varianceQuerySchema = z
  .object({
    month: monthSchema,
    projectId: z.union([z.uuid(), z.literal("SHARED")]),
  })
  .strict();
export const forecastQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    page,
    kind: z.enum(["ALL", "RECEIPT", "PAYMENT"]).default("ALL"),
    state: z.enum(["ALL", "ACTIVE", "CANCELLED"]).default("ACTIVE"),
    projectId: z.union([z.uuid(), z.literal("SHARED")]).optional(),
    from: accountingDateSchema.default("0001-01-01"),
    to: accountingDateSchema.default("9999-12-31"),
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End date must follow start date.",
  });
