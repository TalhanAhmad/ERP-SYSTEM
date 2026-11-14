import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../accounting/schemas";
import { pkrAmountSchema } from "../accounting/money";
const metadata = z
  .object({
    tag: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9._-]{3,40}(?![\s\S])/),
    description: z.string().trim().min(1).max(1000),
    location: z.string().trim().min(1).max(160),
    custodianId: z.uuid().nullable().default(null),
    inServiceDate: accountingDateSchema,
    usefulLifeMonths: z.number().int().min(1).max(1200),
    residualValue: pkrAmountSchema.default("0.00"),
    depreciationMethod: z.literal("STRAIGHT_LINE").default("STRAIGHT_LINE"),
    convention: z
      .enum(["PENDING", "FULL_MONTH_FROM_FIRST_MONTH"])
      .default("PENDING"),
    firstDepMonth: z
      .string()
      .regex(/^[0-9]{4}-(0[1-9]|1[0-2])(?![\s\S])/)
      .refine((v) => v >= "0001-01")
      .nullable()
      .default(null),
    policyEvidence: z.string().trim().min(3).max(1000).nullable().default(null),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.convention === "PENDING" && d.firstDepMonth)
      c.addIssue({
        code: "custom",
        path: ["firstDepMonth"],
        message:
          "Confirm the convention before choosing a first depreciation month.",
      });
    if (
      d.convention === "FULL_MONTH_FROM_FIRST_MONTH" &&
      (!d.firstDepMonth ||
        !d.policyEvidence ||
        d.firstDepMonth < d.inServiceDate.slice(0, 7))
    )
      c.addIssue({
        code: "custom",
        path: ["firstDepMonth"],
        message:
          "Record reviewed evidence and choose a first month on or after service.",
      });
  });
export const assetCreateSchema = metadata
  .safeExtend({
    billLineId: z.uuid().nullable().default(null),
    fundingMovementId: z.uuid().nullable().default(null),
    cost: pkrAmountSchema.refine((v) => v !== "0.00"),
  })
  .superRefine((d, c) => {
    if (!!d.billLineId === !!d.fundingMovementId)
      c.addIssue({
        code: "custom",
        message: "Choose exactly one posted purchase source.",
      });
    if (
      BigInt(d.residualValue.replace(".", "")) > BigInt(d.cost.replace(".", ""))
    )
      c.addIssue({
        code: "custom",
        path: ["residualValue"],
        message: "Residual value cannot exceed cost.",
      });
  });
export const assetSchemas = {
  CREATE: assetCreateSchema,
  UPDATE: metadata.safeExtend({ expectedVersion: versionSchema }),
  VOID: versionReasonSchema,
};
export type AssetAction = keyof typeof assetSchemas;
export const assetQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z
      .enum(["REGISTERED", "DISPOSED", "VOIDED", "ALL"])
      .default("REGISTERED"),
    custodianId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export const assetOptionSchema = z
  .object({
    kind: z.enum(["BILL_LINE", "FUNDING_MOVEMENT", "CUSTODIAN"]),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
