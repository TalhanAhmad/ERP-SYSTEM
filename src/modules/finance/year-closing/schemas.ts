import { z } from "zod";
import { reasonSchema, versionSchema } from "../accounting/schemas";
import { closeSchemas, closeQuerySchema } from "../closing/schemas";
import { accountingDateSchema as dateSchema } from "../accounting/schemas";
export const yearSchemas = {
  CREATE: z
    .object({
      name: z.string().trim().min(1).max(120),
      startDate: dateSchema,
      endDate: dateSchema,
      retainedAccountId: z.uuid(),
      evidence: z.string().trim().min(3).max(1000),
      reason: reasonSchema,
    })
    .strict()
    .refine((v) => v.endDate >= v.startDate, {
      path: ["endDate"],
      message: "End date must be on or after the start date.",
    }),
  CLOSE: closeSchemas.CLOSE,
  REOPEN: closeSchemas.REOPEN,
  VOID: z
    .object({ expectedVersion: versionSchema, reason: reasonSchema })
    .strict(),
};
export type YearAction = keyof typeof yearSchemas;
export const yearQuerySchema = closeQuerySchema;
