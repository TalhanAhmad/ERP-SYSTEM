import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../../accounting/schemas";
const page = z.coerce.number().int().min(1).max(10000).default(1);
const display = {
  q: z.string().trim().max(100).default(""),
  page,
  issuePage: page,
};
export const profitLossQuerySchema = z
  .object({ ...display, from: accountingDateSchema, to: accountingDateSchema })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End must be on or after start.",
  });
export const balanceSheetQuerySchema = z
  .object({ ...display, asOf: accountingDateSchema })
  .strict();
export const statementSettingsQuerySchema = z
  .object({ q: display.q, page })
  .strict();
export const statementSettingSchemas = {
  POLICY_SET: z
    .object({
      overdraftPresentation: z.enum(["UNREVIEWED", "CURRENT_LIABILITY"]),
      evidence: z.string().trim().min(3).max(1000),
      expectedVersion: versionSchema.nullable().default(null),
      reason: reasonSchema,
    })
    .strict(),
  TAX_MAPPING_SET: z
    .object({
      accountId: z.uuid(),
      active: z.boolean(),
      evidence: z.string().trim().min(3).max(1000),
      expectedVersion: versionSchema.nullable().default(null),
      reason: reasonSchema,
    })
    .strict(),
};
export type StatementSettingAction = keyof typeof statementSettingSchemas;
