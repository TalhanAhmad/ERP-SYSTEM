import { z } from "zod";
import { pkrAmountSchema } from "../../accounting/money";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../../accounting/schemas";
import { MAX_STATEMENT_BYTES, statementMappingSchema } from "./csv";
export const statementHashSchema = z.string().regex(/^[0-9a-f]{64}(?![\s\S])/);
export const statementBalanceSchema = z.string().transform((v, ctx) => {
  const negative = v.startsWith("-"),
    parsed = pkrAmountSchema.safeParse(negative ? v.slice(1) : v);
  if (!parsed.success) {
    ctx.addIssue({
      code: "custom",
      message: "Use an exact signed PKR balance.",
    });
    return z.NEVER;
  }
  return negative && parsed.data !== "0.00" ? "-" + parsed.data : parsed.data;
});
export const statementReserveSchema = z
  .object({
    cashAccountId: z.uuid(),
    fileName: z
      .string()
      .trim()
      .min(5)
      .max(180)
      .regex(/^[^\\/\x00-\x1f\x7f]+\.csv$/i),
    byteSize: z.number().int().min(1).max(MAX_STATEMENT_BYTES),
    sha256: statementHashSchema,
    replacesId: z.uuid().nullable().default(null),
    reason: reasonSchema,
  })
  .strict();
export const statementChunkSchema = z
  .object({
    index: z.number().int().min(0).max(2),
    content: z
      .string()
      .min(4)
      .max(2_796_204)
      .regex(/^[A-Za-z0-9+/]*={0,2}(?![\s\S])/),
    sha256: statementHashSchema,
    intent: statementHashSchema,
  })
  .strict();
const metadata = z
  .object({
    mapping: statementMappingSchema,
    startDate: accountingDateSchema,
    endDate: accountingDateSchema,
    openingBalance: statementBalanceSchema,
    closingBalance: statementBalanceSchema,
    currency: z.literal("PKR").default("PKR"),
  })
  .strict()
  .refine((v) => v.startDate <= v.endDate, {
    path: ["endDate"],
    message: "Statement end must follow start.",
  });
export const statementPreviewSchema = metadata;
export const statementImportSchema = metadata
  .safeExtend({
    expectedVersion: versionSchema,
    basisHash: statementHashSchema,
    acknowledgedRows: z
      .array(z.number().int().min(2).max(5026))
      .max(5000)
      .refine(
        (v) => new Set(v).size === v.length,
        "Acknowledge each source record once.",
      )
      .default([]),
    duplicateReview: z.string().trim().max(1000).default(""),
    reason: reasonSchema,
  })
  .refine(
    (v) => v.acknowledgedRows.length === 0 || v.duplicateReview.length >= 3,
    {
      path: ["duplicateReview"],
      message: "Explain the reviewed potential duplicates.",
    },
  );
export const statementActionSchema = versionReasonSchema;
export const statementBatchQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    cashAccountId: z.uuid().optional(),
    state: z.enum(["ALL", "IMPORTED", "VOIDED"]).default("ALL"),
  })
  .strict();
export const statementLineQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).max(200).default(1) })
  .strict();
