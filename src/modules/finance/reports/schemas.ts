import { z } from "zod";
import { accountingDateSchema } from "../accounting/schemas";
const fields = {
  from: accountingDateSchema,
  to: accountingDateSchema,
  page: z.coerce.number().int().min(1).max(10000).default(1),
};
const range = (v: { from: string; to: string }) => v.from <= v.to;
export const generalLedgerQuerySchema = z
  .object({ ...fields, accountId: z.uuid() })
  .strict()
  .refine(range, {
    path: ["to"],
    message: "End date must be on or after start.",
  });
export const trialBalanceQuerySchema = z
  .object({
    ...fields,
    q: z.string().trim().max(100).default(""),
    includeZero: z.enum(["YES", "NO"]).default("NO"),
  })
  .strict()
  .refine(range, {
    path: ["to"],
    message: "End date must be on or after start.",
  });
export const reportAccountQuerySchema = z
  .object({ q: z.string().trim().max(100).default(""), page: fields.page })
  .strict();
