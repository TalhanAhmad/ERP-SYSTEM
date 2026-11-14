import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { pkrAmountSchema } from "../../accounting/money";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../../accounting/schemas";
export const loanDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    partyId: z.uuid(),
    direction: z.enum(["RECEIVED", "ADVANCED"]),
    startDate: accountingDateSchema,
    maturityDate: accountingDateSchema,
    agreedPrincipal: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Agreed limit must be positive.",
    ),
    annualRate: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?(?![\s\S])/)
      .refine((v) => new Prisma.Decimal(v).lte(1000))
      .nullable()
      .default(null),
    agreement: z.string().trim().min(3).max(1000),
    principalAccountId: z.uuid(),
    interestAccountId: z.uuid(),
    interestResultAccountId: z.uuid(),
    manualSchedule: z
      .array(
        z
          .object({
            dueDate: accountingDateSchema,
            principal: pkrAmountSchema,
            interest: pkrAmountSchema,
          })
          .strict(),
      )
      .max(120)
      .default([]),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.maturityDate < d.startDate)
      c.addIssue({
        code: "custom",
        path: ["maturityDate"],
        message: "Maturity cannot precede start.",
      });
    let scheduled = new Prisma.Decimal(0);
    for (const r of d.manualSchedule) {
      scheduled = scheduled.plus(r.principal);
      if (r.dueDate < d.startDate || r.dueDate > d.maturityDate)
        c.addIssue({
          code: "custom",
          path: ["manualSchedule"],
          message: "Schedule dates must fall within the agreement.",
        });
    }
    if (scheduled.gt(d.agreedPrincipal))
      c.addIssue({
        code: "custom",
        path: ["manualSchedule"],
        message: "Scheduled principal exceeds the agreed limit.",
      });
  });
export const loanSchemas = {
  CREATE: loanDraftSchema,
  UPDATE: loanDraftSchema.safeExtend({ expectedVersion: versionSchema }),
  ARCHIVE: versionReasonSchema,
  REACTIVATE: versionReasonSchema,
};
export type LoanAction = keyof typeof loanSchemas;
export const loanQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    direction: z.enum(["ALL", "RECEIVED", "ADVANCED"]).default("ALL"),
    active: z.enum(["ALL", "ACTIVE", "ARCHIVED"]).default("ACTIVE"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    asOf: accountingDateSchema.default("9999-12-31"),
  })
  .strict();
