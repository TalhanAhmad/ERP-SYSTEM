import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../accounting/schemas";
import {
  calculatePkrLine,
  subtractPkr,
  sumPkrLines,
  quantitySchema,
  unitRateSchema,
  pkrAmountSchema,
} from "../accounting/money";
export const billLineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: quantitySchema,
    unitRate: unitRateSchema,
    discountAmount: pkrAmountSchema.default("0.00"),
    treatment: z.enum(["EXPENSE", "PREPAYMENT", "ASSET"]),
    costAccountId: z.uuid(),
    projectId: z.uuid().nullable().default(null),
  })
  .strict();
type BillCalculationLine = Pick<
  z.output<typeof billLineSchema>,
  "quantity" | "unitRate" | "discountAmount"
>;
export function calculateBill(lines: BillCalculationLine[]) {
  const values = lines.map((l) => {
    const lineAmount = calculatePkrLine(l.quantity, l.unitRate),
      discountAmount = pkrAmountSchema.parse(l.discountAmount),
      netAmount = subtractPkr(lineAmount, discountAmount);
    return {
      lineAmount,
      discountAmount,
      netAmount,
      taxAmount: "0.00",
      totalAmount: netAmount,
    };
  });
  return {
    lines: values,
    lineAmount: sumPkrLines(values.map((l) => l.lineAmount)),
    discountAmount: sumPkrLines(values.map((l) => l.discountAmount)),
    netAmount: sumPkrLines(values.map((l) => l.netAmount)),
    taxAmount: "0.00",
    totalAmount: sumPkrLines(values.map((l) => l.totalAmount)),
  };
}
export const billDraftSchema = z
  .object({
    reference: z.string().trim().min(1).max(80),
    partyId: z.uuid(),
    kind: z.enum(["BILL", "EXPENSE"]),
    referenceReliable: z.boolean().default(true),
    duplicateAcknowledged: z.boolean().default(false),
    payableAccountId: z.uuid().nullable().default(null),
    cashAccountId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    billDate: accountingDateSchema,
    postingDate: accountingDateSchema,
    dueDate: accountingDateSchema,
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    currency: z.literal("PKR").default("PKR"),
    lines: z.array(billLineSchema).min(1).max(100),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, ctx) => {
    if (
      (d.kind === "BILL" && (!d.payableAccountId || d.cashAccountId)) ||
      (d.kind === "EXPENSE" && (!d.cashAccountId || d.payableAccountId))
    )
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message:
          "Bills require a payable account; immediate expenses require a cash account.",
      });
    if (d.postingDate < d.billDate)
      ctx.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede the bill date.",
      });
    if (d.dueDate < d.billDate)
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot precede the bill date.",
      });
    try {
      calculateBill(d.lines);
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message:
          "Check quantities, rounded amounts, discounts and supported PKR totals.",
      });
    }
  });
const versionBody = z
  .object({ expectedVersion: versionSchema, reason: reasonSchema })
  .strict();
export const billSchemas = {
  CREATE: billDraftSchema,
  UPDATE: billDraftSchema.safeExtend({ expectedVersion: versionSchema }),
  POST: versionBody,
  VOID: versionBody,
};
export type BillAction = keyof typeof billSchemas;
export const billQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z.enum(["ALL", "DRAFT", "POSTED", "VOIDED"]).default("ALL"),
    partyId: z.uuid().optional(),
    from: accountingDateSchema.optional(),
    to: accountingDateSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(["date_desc", "date_asc", "number"]).default("date_desc"),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || q.to >= q.from,
    "End date must not precede start date.",
  );
