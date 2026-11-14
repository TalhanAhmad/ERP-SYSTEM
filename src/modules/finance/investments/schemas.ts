import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../accounting/schemas";
const optionalAccount = z.uuid().nullable().default(null);
export const holdingDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    partyId: z.uuid(),
    investmentType: z.string().trim().min(1).max(60),
    unitMode: z.enum(["UNIT", "AMOUNT"]),
    classification: z.enum(["CURRENT", "NONCURRENT"]),
    policyStatus: z.enum(["PENDING", "REVIEWED"]),
    measurementMode: z.enum(["COST", "MANUAL_VALUATION"]),
    valuationTreatment: z.enum(["PROFIT_LOSS", "EQUITY"]),
    policy: z.string().trim().min(3).max(2000),
    evidence: z.string().trim().min(3).max(1000),
    investmentAccountId: z.uuid(),
    gainAccountId: optionalAccount,
    lossAccountId: optionalAccount,
    feeAccountId: optionalAccount,
    incomeAccountId: optionalAccount,
    incomeControlAccountId: optionalAccount,
    valuationOffsetAccountId: optionalAccount,
    impairmentAccountId: optionalAccount,
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.policyStatus === "REVIEWED") {
      for (const key of [
        "gainAccountId",
        "lossAccountId",
        "feeAccountId",
        "incomeAccountId",
        "incomeControlAccountId",
        "impairmentAccountId",
      ] as const)
        if (!d[key])
          c.addIssue({
            code: "custom",
            path: [key],
            message:
              "Configure the reviewed posting map before activating this policy.",
          });
      if (
        d.measurementMode === "MANUAL_VALUATION" &&
        !d.valuationOffsetAccountId
      )
        c.addIssue({
          code: "custom",
          path: ["valuationOffsetAccountId"],
          message: "Choose the reviewed valuation offset.",
        });
    }
  });
export const holdingSchemas = {
  CREATE: holdingDraftSchema,
  UPDATE: holdingDraftSchema.safeExtend({ expectedVersion: versionSchema }),
  ARCHIVE: versionReasonSchema,
  REACTIVATE: versionReasonSchema,
};
export type HoldingAction = keyof typeof holdingSchemas;
export const holdingQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    active: z.enum(["ALL", "ACTIVE", "ARCHIVED"]).default("ACTIVE"),
    policyStatus: z.enum(["ALL", "PENDING", "REVIEWED"]).default("ALL"),
    classification: z.enum(["ALL", "CURRENT", "NONCURRENT"]).default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    asOf: accountingDateSchema.default("9999-12-31"),
  })
  .strict();
export const lotQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    asOf: accountingDateSchema.default("9999-12-31"),
  })
  .strict();
