import { z } from "zod";
import { accountingDateSchema } from "../../accounting/schemas";
const page = z.coerce.number().int().min(1).max(10000).default(1);
export const ageingBuckets = [
  "ALL",
  "NOT_DUE",
  "DAYS_1_30",
  "DAYS_31_60",
  "DAYS_61_90",
  "OVER_90",
] as const;
export const ageingQuerySchema = z
  .object({
    asOf: accountingDateSchema,
    q: z.string().trim().max(100).default(""),
    page,
    issuePage: page,
    includeSettled: z.enum(["YES", "NO"]).default("NO"),
    bucket: z.enum(ageingBuckets).default("ALL"),
  })
  .strict();
export const ageingHistoryQuerySchema = z
  .object({ asOf: accountingDateSchema, documentId: z.uuid(), page })
  .strict();
