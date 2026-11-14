import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../accounting/schemas";
import { pkrAmountSchema } from "../accounting/money";
import { movementKinds } from "./kinds";
export { fundingKinds, movementKinds } from "./kinds";
export const movementDraftSchema = z
  .object({
    kind: z.enum(movementKinds),
    reference: z.string().trim().min(1).max(80),
    documentDate: accountingDateSchema,
    postingDate: accountingDateSchema,
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    currency: z.literal("PKR").default("PKR"),
    amount: pkrAmountSchema,
    feeAmount: pkrAmountSchema.default("0.00"),
    allocations: z
      .array(
        z
          .object({
            lotId: z.uuid(),
            units: z
              .string()
              .regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?(?![\s\S])/)
              .refine((v) => /[1-9]/.test(v))
              .nullable()
              .default(null),
            carryingAmount: pkrAmountSchema
              .refine((v) => v !== "0.00")
              .nullable()
              .default(null),
            disposeAll: z.boolean().default(false),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    fromCashId: z.uuid().nullable().default(null),
    toCashId: z.uuid().nullable().default(null),
    partyId: z.uuid().nullable().default(null),
    controlAccountId: z.uuid().nullable().default(null),
    counterAccountId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    approvalEvidence: z
      .string()
      .trim()
      .min(3)
      .max(1000)
      .nullable()
      .default(null),
    billId: z.uuid().nullable().default(null),
    loanId: z.uuid().nullable().default(null),
    holdingId: z.uuid().nullable().default(null),
    units: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?(?![\s\S])/)
      .refine((v) => /[1-9]/.test(v), "Units must be positive.")
      .nullable()
      .default(null),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.amount === "0.00" && d.kind !== "INVESTMENT_DISPOSAL")
      c.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Amount must be positive.",
      });
    const lotKind = [
      "INVESTMENT_DISPOSAL",
      "INVESTMENT_IMPAIRMENT",
      "INVESTMENT_VALUATION_UP",
      "INVESTMENT_VALUATION_DOWN",
    ].includes(d.kind);
    if (
      d.allocations.length > 0 !== lotKind ||
      new Set(d.allocations.map((a) => a.lotId)).size !== d.allocations.length
    )
      c.addIssue({
        code: "custom",
        path: ["allocations"],
        message:
          "Choose distinct explicit lots for disposal or value adjustment.",
      });
    if (d.feeAmount !== "0.00" && d.kind !== "INVESTMENT_DISPOSAL")
      c.addIssue({
        code: "custom",
        path: ["feeAmount"],
        message: "Fees are recorded only on a disposal.",
      });

    if (
      d.kind === "TRANSFER" &&
      (!d.fromCashId ||
        !d.toCashId ||
        d.fromCashId === d.toCashId ||
        d.partyId ||
        d.controlAccountId ||
        d.counterAccountId ||
        d.projectId ||
        d.approvalEvidence ||
        d.billId ||
        d.loanId ||
        d.holdingId ||
        d.units)
    )
      c.addIssue({
        code: "custom",
        path: ["toCashId"],
        message: "Choose two different bank/cash accounts.",
      });
    if (
      d.kind !== "TRANSFER" &&
      !d.kind.startsWith("LOAN_") &&
      !d.kind.startsWith("INVESTMENT_")
    ) {
      if (d.holdingId || d.units)
        c.addIssue({
          code: "custom",
          message: "Choose the investment workflow.",
        });
      if (d.loanId)
        c.addIssue({
          code: "custom",
          path: ["loanId"],
          message: "Choose the loan workflow.",
        });
      const incoming = d.kind === "CAPITAL_CONTRIBUTION",
        outgoing = [
          "CAPITAL_RETURN",
          "DISTRIBUTION",
          "FOUNDER_REIMBURSEMENT",
        ].includes(d.kind),
        noncash = !incoming && !outgoing;
      if (
        !d.partyId ||
        !d.controlAccountId ||
        !!d.toCashId !== incoming ||
        !!d.fromCashId !== outgoing ||
        !!d.counterAccountId !== noncash ||
        !!d.billId !== (d.kind === "FOUNDER_BILL_SETTLEMENT")
      )
        c.addIssue({
          code: "custom",
          message:
            "Choose the contributor and exact mappings required by this funding classification.",
        });
      if (
        ["CAPITAL_RETURN", "DISTRIBUTION", "NONCASH_CAPITAL"].includes(
          d.kind,
        ) &&
        !d.approvalEvidence
      )
        c.addIssue({
          code: "custom",
          path: ["approvalEvidence"],
          message:
            "Record the explicit authorization or reviewed noncash evidence.",
        });
    }
    if (d.kind.startsWith("LOAN_")) {
      if (d.holdingId || d.units)
        c.addIssue({
          code: "custom",
          message: "Loan sources cannot reference holdings.",
        });
      if (
        !d.loanId ||
        d.partyId ||
        d.controlAccountId ||
        d.billId ||
        d.projectId
      )
        c.addIssue({
          code: "custom",
          message:
            "Choose a loan; contributor and controls come from its reviewed terms.",
        });
      const adjustment = [
        "LOAN_PRINCIPAL_INCREASE",
        "LOAN_PRINCIPAL_DECREASE",
      ].includes(d.kind);
      if (
        !!d.counterAccountId !== adjustment ||
        (adjustment && !d.approvalEvidence)
      )
        c.addIssue({
          code: "custom",
          message:
            "Principal adjustments require an approved ordinary counter account.",
        });
      if (d.kind === "LOAN_INTEREST_ACCRUAL" && (d.fromCashId || d.toCashId))
        c.addIssue({
          code: "custom",
          message: "Interest accrual has no cash leg.",
        });
      if (
        !adjustment &&
        d.kind !== "LOAN_INTEREST_ACCRUAL" &&
        !d.fromCashId === !d.toCashId
      )
        c.addIssue({
          code: "custom",
          message:
            "Choose exactly one cash leg for settlement or disbursement.",
        });
      if (adjustment && (d.fromCashId || d.toCashId))
        c.addIssue({
          code: "custom",
          message: "Noncash principal adjustments do not use cash legs.",
        });
    }
    if (
      d.kind === "INVESTMENT_ACQUISITION" &&
      (!d.holdingId ||
        !d.fromCashId ||
        d.toCashId ||
        d.partyId ||
        d.controlAccountId ||
        d.counterAccountId ||
        d.loanId ||
        d.billId ||
        d.projectId ||
        d.approvalEvidence)
    )
      c.addIssue({
        code: "custom",
        message:
          "Choose the holding and paying bank; issuer and investment control come from its reviewed policy.",
      });
    if (
      d.kind.startsWith("INVESTMENT_") &&
      d.kind !== "INVESTMENT_ACQUISITION"
    ) {
      if (
        !d.holdingId ||
        d.partyId ||
        d.controlAccountId ||
        d.counterAccountId ||
        d.loanId ||
        d.billId ||
        d.projectId ||
        d.units ||
        d.fromCashId
      )
        c.addIssue({
          code: "custom",
          message: "Choose a holding without issuer/control overrides.",
        });
      const cash =
        ["INVESTMENT_INCOME_RECEIPT", "INVESTMENT_INCOME_SETTLEMENT"].includes(
          d.kind,
        ) ||
        (d.kind === "INVESTMENT_DISPOSAL" && d.amount !== d.feeAmount);
      if (!!d.toCashId !== cash)
        c.addIssue({
          code: "custom",
          path: ["toCashId"],
          message: "Choose a settlement bank only for an actual cash leg.",
        });
      if (
        [
          "INVESTMENT_IMPAIRMENT",
          "INVESTMENT_VALUATION_UP",
          "INVESTMENT_VALUATION_DOWN",
        ].includes(d.kind) &&
        !d.approvalEvidence
      )
        c.addIssue({
          code: "custom",
          path: ["approvalEvidence"],
          message: "Record explicit value-adjustment approval.",
        });
    }
    if (
      [
        "INVESTMENT_IMPAIRMENT",
        "INVESTMENT_VALUATION_UP",
        "INVESTMENT_VALUATION_DOWN",
      ].includes(d.kind)
    ) {
      const total = d.allocations.reduce(
        (n, a) => n + BigInt((a.carryingAmount ?? "0.00").replace(".", "")),
        0n,
      );
      if (total !== BigInt(d.amount.replace(".", "")))
        c.addIssue({
          code: "custom",
          path: ["amount"],
          message: "Reviewed value change must equal the selected lot changes.",
        });
    }
    if (d.postingDate < d.documentDate)
      c.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede document date.",
      });
  });
const action = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const movementSchemas = {
  CREATE: movementDraftSchema,
  UPDATE: movementDraftSchema.safeExtend({ expectedVersion: versionSchema }),
  POST: action,
  VOID: action,
  REVERSE: action.safeExtend({ postingDate: accountingDateSchema }),
};
export type MovementAction = keyof typeof movementSchemas;
export const movementQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    kind: z.enum(["ALL", ...movementKinds, "REVERSAL"]).default("ALL"),
    family: z
      .enum(["ALL", "TRANSFERS", "FUNDING", "LOANS", "INVESTMENTS"])
      .default("ALL"),
    state: z
      .enum(["ALL", "DRAFT", "POSTED", "REVERSED", "VOIDED"])
      .default("ALL"),
    from: accountingDateSchema.optional(),
    to: accountingDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    "End cannot precede start.",
  );
export const cashQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    cashAccountId: z.uuid().optional(),
    from: accountingDateSchema.optional(),
    to: accountingDateSchema.optional(),
    includeInternal: z.enum(["YES", "NO"]).default("YES"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    "End cannot precede start.",
  );
