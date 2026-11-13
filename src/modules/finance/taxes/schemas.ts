import { z } from "zod";
import { accountingDateSchema, reasonSchema } from "../accounting/schemas";
export const taxCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["INDIRECT", "WITHHOLDING"]),
    effectiveFrom: accountingDateSchema,
    effectiveTo: accountingDateSchema.nullable().default(null),
    rate: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?(?![\s\S])/)
      .refine((v) => Number(v) <= 1000),
    mode: z.enum(["EXCLUSIVE", "INCLUSIVE"]),
    rounding: z.enum(["HALF_UP", "DOWN"]),
    inputAccountId: z.uuid(),
    outputAccountId: z.uuid(),
    policyEvidence: z.string().trim().min(3).max(1000),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.inputAccountId === d.outputAccountId)
      c.addIssue({
        code: "custom",
        path: ["outputAccountId"],
        message: "Recoverable and liability controls must differ.",
      });
    if (d.effectiveTo && d.effectiveTo < d.effectiveFrom)
      c.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "End cannot precede start.",
      });
    if (d.kind === "WITHHOLDING" && d.mode !== "EXCLUSIVE")
      c.addIssue({
        code: "custom",
        path: ["mode"],
        message:
          "Withholding records evidenced settlement amounts; use exclusive mode.",
      });
  });
export const taxSchemas = {
  CREATE: taxCodeSchema,
  RETIRE: z.object({ id: z.uuid(), reason: reasonSchema }).strict(),
};
export const taxQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    kind: z.enum(["ALL", "INDIRECT", "WITHHOLDING"]).default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    active: z.enum(["ALL", "ACTIVE", "RETIRED"]).default("ACTIVE"),
  })
  .strict();
