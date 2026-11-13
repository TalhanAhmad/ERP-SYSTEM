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
export const invoiceLineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: quantitySchema,
    unitRate: unitRateSchema,
    discountAmount: pkrAmountSchema.default("0.00"),
    recognition: z.enum(["EARNED", "DEFERRED"]),
    revenueAccountId: z.uuid(),
    deferredAccountId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
  })
  .strict()
  .superRefine((l, ctx) => {
    if ((l.recognition === "DEFERRED") !== (l.deferredAccountId !== null))
      ctx.addIssue({
        code: "custom",
        path: ["deferredAccountId"],
        message:
          "Deferred lines require a deferred-revenue control; earned lines must not specify one.",
      });
  });
type InvoiceCalculationLine = Pick<
  z.output<typeof invoiceLineSchema>,
  "quantity" | "unitRate" | "discountAmount"
>;
export function calculateInvoice(lines: InvoiceCalculationLine[]) {
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
export const invoiceDraftSchema = z
  .object({
    reference: z.string().trim().min(1).max(80).nullable().default(null),
    partyId: z.uuid(),
    receivableAccountId: z.uuid(),
    projectId: z.uuid().nullable().default(null),
    invoiceDate: accountingDateSchema,
    postingDate: accountingDateSchema,
    dueDate: accountingDateSchema,
    description: z.string().trim().min(1).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    currency: z.literal("PKR").default("PKR"),
    lines: z.array(invoiceLineSchema).min(1).max(100),
    reason: reasonSchema,
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.postingDate < d.invoiceDate)
      ctx.addIssue({
        code: "custom",
        path: ["postingDate"],
        message: "Posting cannot precede the invoice date.",
      });
    if (d.dueDate < d.invoiceDate)
      ctx.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot precede the invoice date.",
      });
    try {
      calculateInvoice(d.lines);
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
export const invoiceSchemas = {
  CREATE: invoiceDraftSchema,
  UPDATE: invoiceDraftSchema.safeExtend({ expectedVersion: versionSchema }),
  POST: versionBody,
  VOID: versionBody,
};
export type InvoiceAction = keyof typeof invoiceSchemas;
export const invoiceQuerySchema = z
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
