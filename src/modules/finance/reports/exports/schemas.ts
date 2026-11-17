import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
} from "../../accounting/schemas";
import { ageingBuckets } from "../ageing/schemas";
import { rollforwardKinds } from "../rollforwards/schemas";
export const reportTypes = [
  "GENERAL_LEDGER",
  "TRIAL_BALANCE",
  "PROFIT_LOSS",
  "BALANCE_SHEET",
  "CASH_FLOW",
  "RECEIVABLES_AGEING",
  "PAYABLES_AGEING",
  "ROLL_FORWARD",
  "BUDGET_VARIANCE",
] as const;
export const reportLabels: Record<(typeof reportTypes)[number], string> = {
  GENERAL_LEDGER: "General ledger",
  TRIAL_BALANCE: "Trial balance",
  PROFIT_LOSS: "Profit and loss",
  BALANCE_SHEET: "Balance sheet",
  CASH_FLOW: "Direct cash flow",
  RECEIVABLES_AGEING: "Receivables ageing",
  PAYABLES_AGEING: "Payables ageing",
  ROLL_FORWARD: "Roll-forward",
  BUDGET_VARIANCE: "Budget variance",
};
const dates = { from: accountingDateSchema, to: accountingDateSchema },
  q = z.string().trim().max(100).default("");
const range = <T extends { from: string; to: string }>(v: T) => v.from <= v.to;
const dateError = { path: ["to"], message: "End must be on or after start." };
const ageing = z
  .object({
    asOf: accountingDateSchema,
    q,
    includeSettled: z.enum(["YES", "NO"]).default("NO"),
    bucket: z.enum(ageingBuckets).default("ALL"),
  })
  .strict();
const base = { mode: z.enum(["REVIEW", "FINAL"]), reason: reasonSchema };
export const exportRequestSchema = z.discriminatedUnion("reportType", [
  z
    .object({
      ...base,
      reportType: z.literal("GENERAL_LEDGER"),
      filters: z
        .object({ ...dates, accountId: z.uuid() })
        .strict()
        .refine(range, dateError),
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("TRIAL_BALANCE"),
      filters: z
        .object({
          ...dates,
          q,
          includeZero: z.enum(["YES", "NO"]).default("NO"),
        })
        .strict()
        .refine(range, dateError),
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("PROFIT_LOSS"),
      filters: z
        .object({ ...dates, q })
        .strict()
        .refine(range, dateError),
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("BALANCE_SHEET"),
      filters: z.object({ asOf: accountingDateSchema, q }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("CASH_FLOW"),
      filters: z
        .object({ ...dates, q })
        .strict()
        .refine(range, dateError),
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("RECEIVABLES_AGEING"),
      filters: ageing,
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("PAYABLES_AGEING"),
      filters: ageing,
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("ROLL_FORWARD"),
      filters: z
        .object({ ...dates, q, kind: z.enum(rollforwardKinds) })
        .strict()
        .refine(range, dateError),
    })
    .strict(),
  z
    .object({
      ...base,
      reportType: z.literal("BUDGET_VARIANCE"),
      filters: z
        .object({
          month: z
            .string()
            .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
            .refine((v) => !v.startsWith("0000")),
          projectId: z.union([z.literal("SHARED"), z.uuid()]),
        })
        .strict(),
    })
    .strict(),
]);
export const exportChangeSchema = z
  .object({
    id: z.uuid(),
    expectedVersion: versionSchema,
    reason: reasonSchema,
  })
  .strict();
export const exportQuerySchema = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;
