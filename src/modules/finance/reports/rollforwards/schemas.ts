import { z } from "zod";
import { accountingDateSchema } from "../../accounting/schemas";
export const rollforwardKinds = [
  "PROJECTS",
  "FUNDING",
  "LOANS",
  "INVESTMENTS",
  "ASSETS",
  "ADVANCES",
] as const;
export const rollforwardKindSchema = z.enum(rollforwardKinds);
const page = z.coerce.number().int().min(1).max(10000).default(1);
const dates = { from: accountingDateSchema, to: accountingDateSchema };
export const rollforwardQuerySchema = z
  .object({
    ...dates,
    q: z.string().trim().max(100).default(""),
    page,
    issuePage: page,
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End must be on or after start.",
  });
export const rollforwardHistorySchema = z
  .object({ ...dates, rowKey: z.string().regex(/^[0-9a-f]{64}$/), page })
  .strict()
  .refine((v) => v.from <= v.to, {
    path: ["to"],
    message: "End must be on or after start.",
  });
export const postedSourceQuerySchema = z
  .object({ id: z.uuid(), page })
  .strict();
