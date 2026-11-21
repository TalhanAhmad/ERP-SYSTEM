import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../accounting/schemas";
export const openingKinds = [
  "AR",
  "AP",
  "CASH",
  "LOAN_PRINCIPAL",
  "LOAN_INTEREST",
  "INVESTMENT",
  "INVESTMENT_INCOME",
  "ASSET",
  "CAPITAL",
  "DISTRIBUTION",
  "FOUNDER_PAYABLE",
  "CLIENT_ADVANCE",
  "SUPPLIER_ADVANCE",
  "DEFERRED",
] as const;
const money = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?(?![\s\S])/);
export const openingItemSchema = z
  .object({
    kind: z.enum(openingKinds),
    side: z.enum(["DEBIT", "CREDIT"]).optional(),
    reference: z.string().trim().min(1).max(80),
    originalDate: accountingDateSchema,
    dueDate: accountingDateSchema.nullable().optional(),
    accountId: z.uuid(),
    amount: money,
    partyId: z.uuid().nullable().optional(),
    cashAccountId: z.uuid().nullable().optional(),
    loanId: z.uuid().nullable().optional(),
    holdingId: z.uuid().nullable().optional(),
    secondaryAccountId: z.uuid().nullable().optional(),
    resultAccountId: z.uuid().nullable().optional(),
    receivableAccountId: z.uuid().nullable().optional(),
    costBasis: money.optional(),
    accumulatedDepreciation: money.optional(),
    units: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?(?![\s\S])/)
      .nullable()
      .optional(),
    tag: z
      .string()
      .regex(/^[A-Z0-9._-]{3,40}$/)
      .optional(),
    description: z.string().trim().min(3).max(500),
    location: z.string().trim().min(1).max(160).optional(),
    inServiceDate: accountingDateSchema.optional(),
    residualValue: money.optional(),
    remainingLifeMonths: z.number().int().min(1).max(1200).optional(),
    firstDepMonth: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    policyEvidence: z.string().trim().min(3).max(1000).optional(),
  })
  .strict()
  .superRefine((x, c) => {
    if (x.amount === "0" || /^0\.0{1,2}$/.test(x.amount))
      c.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Opening item must be positive.",
      });
    if (
      [
        "AR",
        "AP",
        "CAPITAL",
        "DISTRIBUTION",
        "FOUNDER_PAYABLE",
        "CLIENT_ADVANCE",
        "SUPPLIER_ADVANCE",
        "DEFERRED",
      ].includes(x.kind) &&
      !x.partyId
    )
      c.addIssue({
        code: "custom",
        path: ["partyId"],
        message: "Choose the original party.",
      });
    if (["AR", "AP"].includes(x.kind) && !x.dueDate)
      c.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Preserve the original due date.",
      });
    if (x.kind === "CASH" && !x.cashAccountId)
      c.addIssue({
        code: "custom",
        path: ["cashAccountId"],
        message: "Choose the cash register.",
      });
    if (x.kind.startsWith("LOAN_") && !x.loanId)
      c.addIssue({
        code: "custom",
        path: ["loanId"],
        message: "Choose the reviewed loan.",
      });
    if (x.kind.startsWith("INVESTMENT") && !x.holdingId)
      c.addIssue({
        code: "custom",
        path: ["holdingId"],
        message: "Choose the reviewed holding.",
      });
    if (x.kind === "ASSET")
      for (const k of [
        "secondaryAccountId",
        "tag",
        "location",
        "inServiceDate",
        "remainingLifeMonths",
        "firstDepMonth",
        "policyEvidence",
      ] as const)
        if (!x[k])
          c.addIssue({
            code: "custom",
            path: [k],
            message: "Supply the reviewed asset cutover policy.",
          });
    if (x.kind === "DEFERRED" && (!x.resultAccountId || !x.receivableAccountId))
      c.addIssue({
        code: "custom",
        path: ["resultAccountId"],
        message:
          "Preserve revenue/receivables mappings for the settled legacy obligation.",
      });
  });
export const openingSourceSchema = z
  .object({
    formatVersion: z.literal(1),
    name: z.string().trim().min(1).max(120),
    currency: z.literal("PKR"),
    cutoverDate: accountingDateSchema,
    clearingAccountId: z.uuid(),
    evidence: z.string().trim().min(3).max(1000),
    trialBalance: z
      .array(
        z
          .object({ accountId: z.uuid(), debit: money, credit: money })
          .strict()
          .refine(
            (x) =>
              !/^0(?:\.0{1,2})?$/.test(x.debit) !==
              !/^0(?:\.0{1,2})?$/.test(x.credit),
            "Use one positive side.",
          ),
      )
      .min(2)
      .max(200),
    items: z.array(openingItemSchema).max(200),
  })
  .strict();
export const openingSchemas = {
  CREATE: z
    .object({
      fileName: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(/\.json$/i),
      sourceText: z
        .string()
        .min(2)
        .max(180000)
        .refine(
          (v) => new TextEncoder().encode(v).byteLength <= 180000,
          "Opening source exceeds 180 KB.",
        ),
      reason: reasonSchema,
    })
    .strict()
    .superRefine((x, c) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(x.sourceText);
      } catch {
        c.addIssue({
          code: "custom",
          path: ["sourceText"],
          message: "Use a valid opening JSON file.",
        });
        return;
      }
      const p = openingSourceSchema.safeParse(parsed);
      if (!p.success)
        for (const issue of p.error.issues)
          c.addIssue({
            code: "custom",
            path: ["sourceText", ...issue.path],
            message: issue.message,
          });
    }),
  POST: z
    .object({
      expectedVersion: versionSchema,
      basisHash: z.string().regex(/^[0-9a-f]{64}$/),
      reviewEvidence: z.string().trim().min(3).max(1000),
      reason: reasonSchema,
    })
    .strict(),
  VOID: z
    .object({ expectedVersion: versionSchema, reason: reasonSchema })
    .strict(),
};
export type OpeningAction = keyof typeof openingSchemas;
export const openingQuery = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
