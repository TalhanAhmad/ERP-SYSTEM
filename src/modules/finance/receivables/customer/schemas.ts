import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../../accounting/schemas";
import { pkrAmountSchema, sumPkrLines } from "../../accounting/money";
export type CustomerResource = "RECEIPT";
export const allocationSchema = z
  .object({
    invoiceId: z.uuid(),
    amount: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Allocation must be positive.",
    ),
  })
  .strict();
export const receiptSchema = z
  .object({
    reference: z.string().trim().min(1).max(80),
    partyId: z.uuid(),
    cashAccountId: z.uuid(),
    feeAccountId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    documentDate: accountingDateSchema,
    postingDate: accountingDateSchema,
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    currency: z.literal("PKR").default("PKR"),
    cashAmount: pkrAmountSchema.refine(
      (v) => v !== "0.00",
      "Cash received must be positive.",
    ),
    feeAmount: pkrAmountSchema.default("0.00"),
    allocations: z.array(allocationSchema).min(1).max(100),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, c) => {
    if (d.postingDate < d.documentDate)
      c.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede receipt date.",
      });
    if ((d.feeAmount !== "0.00") !== (d.feeAccountId !== null))
      c.addIssue({
        code: "custom",
        path: ["feeAccountId"],
        message: "Choose a fee account only when an explicit fee is recorded.",
      });
    if (
      new Set(d.allocations.map((a) => a.invoiceId)).size !==
      d.allocations.length
    )
      c.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "Combine allocations to the same invoice.",
      });
    try {
      if (
        sumPkrLines([d.cashAmount, d.feeAmount]) !==
        sumPkrLines(d.allocations.map((a) => a.amount))
      )
        throw new Error();
    } catch {
      c.addIssue({
        code: "custom",
        path: ["allocations"],
        message:
          "Invoice settlements must equal cash received plus explicit fees, within the supported PKR range.",
      });
    }
  });
const actionSchema = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const customerSchemas = (resource: CustomerResource) => {
  if (resource !== "RECEIPT") throw new Error("Unsupported customer resource");
  return {
    CREATE: receiptSchema,
    UPDATE: receiptSchema.safeExtend({ expectedVersion: versionSchema }),
    POST: actionSchema,
    VOID: actionSchema,
  };
};
export type CustomerAction = keyof ReturnType<typeof customerSchemas>;
export const customerQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z.enum(["ALL", "DRAFT", "POSTED", "VOIDED"]).default("ALL"),
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
