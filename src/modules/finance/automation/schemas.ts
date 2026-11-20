import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../accounting/schemas";
import { pkrAmountSchema } from "../accounting/money";
const month = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])(?![\s\S])/)
  .refine(
    (v) => accountingDateSchema.safeParse(v + "-01").success,
    "Choose a valid month.",
  );
const positive = pkrAmountSchema.refine(
  (v) => v !== "0.00",
  "Amount must be positive.",
);
const common = { description: z.string().trim().min(3).max(500) };
export const billTemplate = z
  .object({
    ...common,
    partyId: z.uuid(),
    payableAccountId: z.uuid(),
    costAccountId: z.uuid(),
    amount: positive.refine(
      (v) => v.split(".")[0].length <= 14,
      "Monthly bill amount must fit its one-unit supplier rate.",
    ),
    dueDays: z.number().int().min(0).max(90),
    projectId: z.uuid().nullable().default(null),
  })
  .strict();
export const journalTemplate = z
  .object({
    ...common,
    debitAccountId: z.uuid(),
    creditAccountId: z.uuid(),
    amount: positive,
    projectId: z.uuid().nullable().default(null),
  })
  .strict()
  .refine(
    (v) => v.debitAccountId !== v.creditAccountId,
    "Choose different accounts.",
  );
export const depreciationTemplate = z
  .object({
    ...common,
    assetId: z.uuid(),
    expenseAccountId: z.uuid(),
    accumulatedAccountId: z.uuid(),
  })
  .strict();
const scheduleBase = {
  name: z.string().trim().min(1).max(120),
  startMonth: month,
  endMonth: month.nullable().default(null),
  day: z.number().int().min(1).max(28),
  evidence: z.string().trim().min(3).max(1000),
  reason: reasonSchema,
};
export const scheduleCreate = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...scheduleBase,
        kind: z.literal("BILL"),
        template: billTemplate,
      })
      .strict(),
    z
      .object({
        ...scheduleBase,
        kind: z.literal("JOURNAL"),
        template: journalTemplate,
      })
      .strict(),
    z
      .object({
        ...scheduleBase,
        kind: z.literal("DEPRECIATION"),
        template: depreciationTemplate,
      })
      .strict(),
  ])
  .refine((v) => !v.endMonth || v.endMonth >= v.startMonth, {
    path: ["endMonth"],
    message: "End month must be on or after start.",
  });
const change = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const automationSchemas = {
  CREATE: scheduleCreate,
  PAUSE: change,
  RESUME: change,
  PREPARE: z.object({ reason: reasonSchema }).strict(),
  RETRY: change,
  RECOGNITION_CREATE: z
    .object({
      invoiceLineId: z.uuid(),
      postingDate: accountingDateSchema,
      amount: positive,
      description: z.string().trim().min(3).max(500),
      evidence: z.string().trim().min(3).max(1000),
      reason: reasonSchema,
    })
    .strict(),
  RECOGNITION_POST: change,
  RECOGNITION_VOID: change,
  RECOGNITION_REVERSE: change
    .extend({ postingDate: accountingDateSchema })
    .strict(),
  OPENING_CREDIT_REVIEW: z
    .object({
      side: z.enum(["CUSTOMER", "SUPPLIER"]),
      documentId: z.uuid(),
      expectedVersion: versionSchema,
      offsetAccountId: z.uuid(),
      evidence: z.string().trim().min(3).max(1000),
      reason: reasonSchema,
    })
    .strict(),
};
export type AutomationAction = keyof typeof automationSchemas;
export const automationQuery = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
export const automationOptions = z
  .object({
    kind: z.enum(["ASSET", "DEFERRED", "EQUITY"]),
    asOf: accountingDateSchema.optional(),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine((v) => v.kind !== "DEFERRED" || !!v.asOf, {
    path: ["asOf"],
    message: "Choose the recognition date first.",
  });
