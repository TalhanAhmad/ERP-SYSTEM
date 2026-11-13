import { z } from "zod";
import {
  accountTypes,
  normalSides,
  reportGroups,
  controlTypes,
  groupsByType,
  debitTypes,
} from "./catalog";
export const reasonSchema = z.string().trim().min(3).max(500);
export const versionSchema = z.number().int().min(1).max(2147483647);
export const accountFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._-]{1,19}$/),
  name: z.string().trim().min(1).max(120),
  type: z.enum(accountTypes),
  normalSide: z.enum(normalSides),
  reportGroup: z.enum(reportGroups),
  controlType: z.enum(controlTypes),
  currency: z.literal("PKR").default("PKR"),
  parentId: z.uuid().nullable().default(null),
  isPosting: z.boolean(),
  isContra: z.boolean(),
  isCashEquivalent: z.boolean(),
};
export const accountSchema = z
  .object({ ...accountFields, reason: reasonSchema })
  .strict()
  .superRefine((a, ctx) => {
    if (!groupsByType[a.type].includes(a.reportGroup))
      ctx.addIssue({
        code: "custom",
        path: ["reportGroup"],
        message: "Choose a report group for this account type.",
      });
    const debit = debitTypes.includes(a.type) !== a.isContra;
    if (a.normalSide !== (debit ? "DEBIT" : "CREDIT"))
      ctx.addIssue({
        code: "custom",
        path: ["normalSide"],
        message:
          "Normal side must match the account type and contra designation.",
      });
    if (
      !a.isPosting &&
      (a.controlType !== "NONE" || a.isContra || a.isCashEquivalent)
    )
      ctx.addIssue({
        code: "custom",
        path: ["isPosting"],
        message:
          "Group accounts cannot be controls, contra accounts or cash equivalents.",
      });
    const assetControls = [
      "TAX_INPUT",
      "WITHHOLDING_RECEIVABLE",
      "CASH",
      "RECEIVABLES",
      "SUPPLIER_ADVANCE",
      "FIXED_ASSET",
      "ACCUMULATED_DEPRECIATION",
      "INVESTMENT",
      "LOAN_RECEIVABLE",
    ];
    const liabilityControls = [
      "TAX_OUTPUT",
      "WITHHOLDING_PAYABLE",
      "PAYABLES",
      "CLIENT_ADVANCE",
      "LOAN_PAYABLE",
      "DEFERRED_REVENUE",
    ];
    if (
      (assetControls.includes(a.controlType) && a.type !== "ASSET") ||
      (liabilityControls.includes(a.controlType) && a.type !== "LIABILITY")
    )
      ctx.addIssue({
        code: "custom",
        path: ["controlType"],
        message: "Control account type is incompatible.",
      });
    if (
      a.controlType !== "NONE" &&
      a.isContra !== (a.controlType === "ACCUMULATED_DEPRECIATION")
    )
      ctx.addIssue({
        code: "custom",
        path: ["isContra"],
        message: "Only accumulated-depreciation controls are contra accounts.",
      });
    if (
      a.isCashEquivalent &&
      (a.controlType !== "CASH" || !a.isPosting || a.isContra)
    )
      ctx.addIssue({
        code: "custom",
        path: ["isCashEquivalent"],
        message: "Cash-equivalent designation requires a posting cash control.",
      });
  });
export const accountUpdateSchema = accountSchema.safeExtend({
  expectedVersion: versionSchema,
});
export const versionReasonSchema = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const accountingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !value.startsWith("0000") &&
      !Number.isNaN(Date.parse(value + "T00:00:00.000Z")) &&
      new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) === value,
    "Use a real calendar date in YYYY-MM-DD format.",
  );
export const periodSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startDate: accountingDateSchema,
    endDate: accountingDateSchema,
    reason: reasonSchema,
  })
  .strict()
  .refine((p) => p.endDate >= p.startDate, {
    path: ["endDate"],
    message: "End date must not precede start date.",
  });
export const periodUpdateSchema = periodSchema.safeExtend({
  expectedVersion: versionSchema,
});
export const accountQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    active: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).default("ACTIVE"),
    type: z.enum(["ALL", ...accountTypes]).default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const periodQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z.enum(["OPEN", "CLOSED", "VOID", "ALL"]).default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
