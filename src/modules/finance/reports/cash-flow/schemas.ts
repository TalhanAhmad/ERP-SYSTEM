import { z } from "zod";
import { accountingDateSchema, reasonSchema } from "../../accounting/schemas";
const page = z.coerce.number().int().min(1).max(10000).default(1);
export const cashFlowQuerySchema = z
  .object({
    from: accountingDateSchema,
    to: accountingDateSchema,
    q: z.string().trim().max(100).default(""),
    page,
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End must be on or after start.",
  });
export const cashFlowReviewQuerySchema = z
  .object({ journalId: z.uuid(), page })
  .strict();
export const cashFlowConfirmSchema = z
  .object({
    journalId: z.uuid(),
    basisHash: z.string().regex(/^[0-9a-f]{64}$/),
    expectedReviewId: z.uuid().nullable().default(null),
    expectedVersion: z.literal(2).nullable().default(null),
    components: z
      .array(
        z
          .object({
            journalLineId: z.uuid(),
            category: z.enum([
              "OPERATING",
              "INVESTING",
              "FINANCING",
              "INTERNAL",
            ]),
            amount: z
              .string()
              .regex(/^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/)
              .refine((v) => v !== "0.00", "Amount must be positive."),
          })
          .strict(),
      )
      .min(1)
      .max(800),
    evidence: z.string().trim().min(3).max(1000),
    reason: reasonSchema,
  })
  .strict();
