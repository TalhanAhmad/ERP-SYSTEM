import { z } from "zod";
export const financeReauthSchema = z
  .object({
    password: z.string().min(1).max(128),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
const base = {
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
};
export const grantSchema = z.object({ ...base, targetId: z.uuid() }).strict();
export const revokeSchema = z
  .object({ ...base, grantVersion: z.number().int().positive() })
  .strict();
export const transferSchema = grantSchema;
export const transferActionSchema = z.object(base).strict();
export type AccessAction =
  "GRANT" | "REVOKE" | "TRANSFER" | "ACCEPT" | "CANCEL";
