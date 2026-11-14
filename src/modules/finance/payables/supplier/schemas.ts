import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../../accounting/schemas";
import { pkrAmountSchema, sumPkrLines } from "../../accounting/money";
export type SupplierResource =
  | "PAYMENT"
  | "ADVANCE_APPLICATION"
  | "SUPPLIER_CREDIT"
  | "SUPPLIER_REFUND"
  | "UNALLOCATION";
export const allocationSchema = z
  .object({
    billId: z.uuid(),
    amount: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Allocation must be positive.",
    ),
  })
  .strict();
export const paymentSchema = z
  .object({
    reference: z.string().trim().min(1).max(80),
    partyId: z.uuid(),
    cashAccountId: z.uuid(),
    advanceAccountId: z.uuid().nullable().default(null),
    feeAccountId: z.null().default(null),
    projectId: z.uuid().nullable().default(null),
    documentDate: accountingDateSchema,
    postingDate: accountingDateSchema,
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    currency: z.literal("PKR").default("PKR"),
    cashAmount: pkrAmountSchema,
    withholdingAmount: pkrAmountSchema.default("0.00"),
    withholdingCodeId: z.uuid().nullable().default(null),
    feeAmount: z.literal("0.00").default("0.00"),
    allocations: z.array(allocationSchema).max(100),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if ((d.withholdingAmount !== "0.00") !== (d.withholdingCodeId !== null))
      c.addIssue({
        code: "custom",
        path: ["withholdingCodeId"],
        message:
          "Choose a withholding code exactly when a supported withholding amount is recorded.",
      });
    if (d.cashAmount === "0.00" && d.withholdingAmount === "0.00")
      c.addIssue({
        code: "custom",
        path: ["cashAmount"],
        message: "Cash or evidenced withholding must be positive.",
      });
    if (d.postingDate < d.documentDate)
      c.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede payment date.",
      });
    if ((d.feeAmount !== "0.00") !== (d.feeAccountId !== null))
      c.addIssue({
        code: "custom",
        path: ["feeAccountId"],
        message: "Choose a fee account only when an explicit fee is recorded.",
      });
    if (
      new Set(d.allocations.map((a) => a.billId)).size !== d.allocations.length
    )
      c.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Combine allocations to the same bill.",
      });
    try {
      const total = sumPkrLines([
          d.cashAmount,
          d.feeAmount,
          d.withholdingAmount,
        ]),
        applied = sumPkrLines(d.allocations.map((a) => a.amount));
      const cashCents = BigInt(total.replace(".", "")),
        appliedCents = BigInt(applied.replace(".", ""));
      if (
        appliedCents > cashCents ||
        cashCents > appliedCents !== (d.advanceAccountId !== null)
      )
        throw new Error();
    } catch {
      c.addIssue({
        code: "custom",
        path: ["allocations"],
        message:
          "Settlements cannot exceed cash plus fees and withholding and withholding. Select a supplier advance account exactly when money remains unallocated.",
      });
    }
  });
export const applicationSchema = z
  .object({
    reference: z.string().trim().min(1).max(80),
    partyId: z.uuid(),
    sourceDocumentId: z.uuid(),
    projectId: z.uuid().nullable().default(null),
    documentDate: accountingDateSchema,
    postingDate: accountingDateSchema,
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    currency: z.literal("PKR").default("PKR"),
    allocations: z.array(allocationSchema).min(1).max(100),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.postingDate < d.documentDate)
      c.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede application date.",
      });
    if (
      new Set(d.allocations.map((a) => a.billId)).size !== d.allocations.length
    )
      c.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Combine allocations to the same bill.",
      });
    try {
      sumPkrLines(d.allocations.map((a) => a.amount));
    } catch {
      c.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Total exceeds the supported PKR range.",
      });
    }
  });
const commercialBase = {
  reference: z.string().trim().min(1).max(80),
  partyId: z.uuid(),
  projectId: z.uuid().nullable().default(null),
  documentDate: accountingDateSchema,
  postingDate: accountingDateSchema,
  description: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(3).max(1000),
  currency: z.literal("PKR").default("PKR"),
  reason: reasonSchema,
};
export const creditLineSchema = z
  .object({
    billLineId: z.uuid(),
    amount: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Credit must be positive.",
    ),
  })
  .strict();
export const creditSchema = z
  .object({
    ...commercialBase,
    billId: z.uuid(),
    advanceAccountId: z.uuid(),
    creditLines: z.array(creditLineSchema).min(1).max(100),
  })
  .strict()
  .superRefine((d, c) => {
    if (d.postingDate < d.documentDate)
      c.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede the credit date.",
      });
    if (
      new Set(d.creditLines.map((l) => l.billLineId)).size !==
      d.creditLines.length
    )
      c.addIssue({
        code: "custom",
        path: ["creditLines"],
        message: "Combine credits to the same bill line.",
      });
    try {
      sumPkrLines(d.creditLines.map((l) => l.amount));
    } catch {
      c.addIssue({
        code: "custom",
        path: ["creditLines"],
        message: "Credit total exceeds the supported range.",
      });
    }
  });
export const refundSchema = z
  .object({
    ...commercialBase,
    sourceDocumentId: z.uuid(),
    cashAccountId: z.uuid(),
    cashAmount: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Refund must be positive.",
    ),
  })
  .strict()
  .superRefine((d, c) => {
    if (d.postingDate < d.documentDate)
      c.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede refund date.",
      });
  });
const actionSchema = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const supplierSchemas = (resource: SupplierResource) => {
  const schema =
    resource === "PAYMENT"
      ? paymentSchema
      : resource === "SUPPLIER_CREDIT"
        ? creditSchema
        : resource === "SUPPLIER_REFUND"
          ? refundSchema
          : applicationSchema;
  return {
    CREATE: schema,
    UPDATE: schema.safeExtend({ expectedVersion: versionSchema }),
    POST: actionSchema,
    VOID: actionSchema,
    REVERSE: actionSchema.safeExtend({ postingDate: accountingDateSchema }),
    UNALLOCATE: actionSchema.safeExtend({
      postingDate: accountingDateSchema,
      advanceAccountId: z.uuid(),
    }),
  };
};
export type SupplierAction = keyof ReturnType<typeof supplierSchemas>;
export const supplierQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z
      .enum(["ALL", "DRAFT", "POSTED", "VOIDED", "REVERSED"])
      .default("ALL"),
    partyId: z.uuid().optional(),
    from: accountingDateSchema.optional(),
    to: accountingDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || q.to >= q.from,
    "End date must follow start date.",
  );
