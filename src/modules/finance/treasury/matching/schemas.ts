import { z } from "zod";
import { pkrAmountSchema } from "../../accounting/money";
import {
  reasonSchema,
  versionReasonSchema,
  accountingDateSchema,
} from "../../accounting/schemas";
const allocations = z
  .array(
    z
      .object({
        statementLineId: z.uuid(),
        journalLineId: z.uuid(),
        amount: pkrAmountSchema.refine(
          (v) => v !== "0.00",
          "Match amount must be positive.",
        ),
      })
      .strict(),
  )
  .min(1)
  .max(100)
  .refine(
    (v) =>
      new Set(v.map((a) => a.statementLineId + ":" + a.journalLineId)).size ===
      v.length,
    "Combine repeated allocations to the same pair.",
  );
export const bankMatchPreviewSchema = z
  .object({ cashAccountId: z.uuid(), allocations })
  .strict();
export const bankMatchSchemas = {
  MATCH: bankMatchPreviewSchema.extend({
    description: z.string().trim().min(3).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    basisHash: z.string().regex(/^[0-9a-f]{64}(?![\s\S])/),
    reason: reasonSchema,
  }),
  UNMATCH: versionReasonSchema,
};
export type BankMatchAction = keyof typeof bankMatchSchemas;
export const bankMatchQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    cashAccountId: z.uuid().optional(),
    state: z.enum(["ALL", "MATCHED", "UNMATCHED"]).default("ALL"),
  })
  .strict();
export const bankMatchOptionsSchema = z
  .object({
    kind: z.enum(["STATEMENT", "CASH"]),
    cashAccountId: z.uuid(),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    from: accountingDateSchema.default("0001-01-01"),
    to: accountingDateSchema.default("9999-12-31"),
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End date must follow start.",
  });
