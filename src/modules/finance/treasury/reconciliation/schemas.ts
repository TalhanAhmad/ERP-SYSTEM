import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../../accounting/schemas";
import { statementBalanceSchema } from "../statements/schemas";
const base = {
  cashAccountId: z.uuid(),
  evidence: z.string().trim().min(3).max(1000),
  replacesId: z.uuid().nullable().default(null),
  expectedPriorVersion: versionSchema.nullable().default(null),
  reason: reasonSchema,
};
const create = z
  .discriminatedUnion("mode", [
    z
      .object({
        ...base,
        mode: z.literal("STATEMENT"),
        statementBatchId: z.uuid(),
      })
      .strict(),
    z
      .object({
        ...base,
        mode: z.literal("ZERO_ACTIVITY"),
        startDate: accountingDateSchema,
        cutoffDate: accountingDateSchema,
        openingBalance: statementBalanceSchema,
        closingBalance: statementBalanceSchema,
      })
      .strict(),
  ])
  .superRefine((v, ctx) => {
    if (v.mode === "ZERO_ACTIVITY" && v.startDate > v.cutoffDate)
      ctx.addIssue({
        code: "custom",
        path: ["cutoffDate"],
        message: "Cutoff must follow start.",
      });
    if (!!v.replacesId !== !!v.expectedPriorVersion)
      ctx.addIssue({
        code: "custom",
        path: ["replacesId"],
        message:
          "Choose the prior retained review and its current version together.",
      });
  });
const note = z
  .object({
    rowKey: z.string().regex(/^(CASH|STATEMENT):[0-9a-f-]{36}(?![\s\S])/),
    kind: z.enum(["DOCUMENT", "EXCLUDE_DUPLICATE"]),
    note: z.string().trim().min(3).max(500),
    peerStatementLineId: z.uuid().nullable().default(null),
  })
  .strict()
  .refine(
    (v) =>
      (v.kind === "EXCLUDE_DUPLICATE") === (v.peerStatementLineId !== null),
    {
      path: ["peerStatementLineId"],
      message: "Duplicate exclusion needs its actual fully matched peer.",
    },
  );
export const reconciliationSchemas = {
  CREATE: create,
  NOTES: z
    .object({
      expectedVersion: versionSchema,
      notes: z
        .array(note)
        .min(1)
        .max(100)
        .refine(
          (v) => new Set(v.map((n) => n.rowKey)).size === v.length,
          "Update each row only once.",
        ),
      reason: reasonSchema,
    })
    .strict(),
  REFRESH: versionReasonSchema,
  FINALIZE: versionReasonSchema,
  VOID: versionReasonSchema,
  REOPEN: versionReasonSchema,
};
export type ReconciliationAction = keyof typeof reconciliationSchemas;
export const reconciliationQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    cashAccountId: z.uuid().optional(),
    state: z
      .enum(["ALL", "DRAFT", "FINALIZED", "VOIDED", "REOPENED"])
      .default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
