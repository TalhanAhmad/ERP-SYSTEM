import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../accounting/schemas";
import { pkrAmountSchema, sumPkrLines } from "../accounting/money";
export const journalLineSchema = z
  .object({
    accountId: z.uuid(),
    description: z.string().trim().min(1).max(500),
    debit: pkrAmountSchema,
    credit: pkrAmountSchema,
    projectId: z.uuid().nullable().default(null),
  })
  .strict()
  .refine((l) => (l.debit !== "0.00") !== (l.credit !== "0.00"), {
    message: "Each line needs exactly one positive debit or credit.",
  });
export const journalDraftSchema = z
  .object({
    reference: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    postingDate: accountingDateSchema,
    currency: z.literal("PKR").default("PKR"),
    lines: z.array(journalLineSchema).min(1).max(200),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((draft, ctx) => {
    try {
      sumPkrLines(draft.lines.map((l) => l.debit));
      sumPkrLines(draft.lines.map((l) => l.credit));
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each total must fit the supported PKR range.",
      });
    }
  });

export const journalVersionSchema = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const ledgerSchemas = {
  CREATE: journalDraftSchema,
  UPDATE: journalDraftSchema.safeExtend({ expectedVersion: versionSchema }),
  POST: journalVersionSchema,
  VOID: journalVersionSchema,
  REVERSE: journalVersionSchema.extend({ postingDate: accountingDateSchema }),
  BULK_VOID: z
    .object({
      items: z
        .array(
          z.object({ id: z.uuid(), expectedVersion: versionSchema }).strict(),
        )
        .min(1)
        .max(50),
      reason: reasonSchema,
    })
    .strict()
    .refine(
      (x) => new Set(x.items.map((i) => i.id)).size === x.items.length,
      "Choose each draft only once.",
    ),
};
export type LedgerAction = keyof typeof ledgerSchemas;
export const journalQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z
      .enum(["ALL", "DRAFT", "POSTED", "REVERSED", "VOIDED"])
      .default("ALL"),
    from: accountingDateSchema.optional(),
    to: accountingDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(["date_desc", "date_asc", "reference"]).default("date_desc"),
  })
  .strict()
  .refine(
    (x) => !x.from || !x.to || x.to >= x.from,
    "End date must not precede start date.",
  );
export function journalTotals(lines: { debit: string; credit: string }[]) {
  const debit = sumPkrLines(lines.map((l) => l.debit)),
    credit = sumPkrLines(lines.map((l) => l.credit));
  return {
    debit,
    credit,
    balanced: debit === credit && debit !== "0.00" && lines.length >= 2,
  };
}
