import { z } from "zod";
import {
  accountingDateSchema,
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../../accounting/schemas";
import { pkrAmountSchema } from "../../accounting/money";
const hash = z.string().regex(/^[0-9a-f]{64}(?![\s\S])/),
  target = z
    .object({ projectId: z.uuid().nullable(), amount: pkrAmountSchema })
    .strict();
const unique = (values: { projectId: string | null }[]) =>
  new Set(values.map((v) => v.projectId ?? "company")).size === values.length;
const body = z
  .object({
    postingDate: accountingDateSchema,
    description: z.string().trim().min(3).max(1000),
    evidence: z.string().trim().min(3).max(1000),
    basisHash: hash,
    targets: z
      .array(target)
      .min(1)
      .max(100)
      .refine(unique, "Use one split per project or shared company dimension."),
    reason: reasonSchema,
  })
  .strict();
export const costSchemas = {
  CREATE: body.extend({ sourceLineId: z.uuid() }),
  UPDATE: body.extend({ expectedVersion: versionSchema }),
  POST: versionReasonSchema,
  VOID: versionReasonSchema,
  REVERSE: versionReasonSchema.extend({ postingDate: accountingDateSchema }),
};
export type CostAction = keyof typeof costSchemas;
const percent = z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?(?![\s\S])/);
export const costPreviewSchema = z
  .object({
    sourceLineId: z.uuid(),
    basisHash: hash,
    targets: z
      .array(
        z
          .object({ projectId: z.uuid().nullable(), percentage: percent })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(unique, "Use one split per project."),
  })
  .strict();
export const costSourceQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export const costQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    state: z
      .enum(["ALL", "DRAFT", "POSTED", "VOIDED", "REVERSED"])
      .default("ALL"),
  })
  .strict();
export const projectResultQuerySchema = z
  .object({
    from: accountingDateSchema.default("0001-01-01"),
    to: accountingDateSchema.default("9999-12-31"),
  })
  .strict()
  .refine((q) => q.from <= q.to, {
    path: ["to"],
    message: "End date must follow start date.",
  });
