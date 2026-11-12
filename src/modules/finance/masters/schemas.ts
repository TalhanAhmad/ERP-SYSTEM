import { z } from "zod";
import {
  reasonSchema,
  versionSchema,
  versionReasonSchema,
} from "../accounting/schemas";
export const partyKinds = [
  "CLIENT",
  "SUPPLIER",
  "BOTH",
  "EMPLOYEE",
  "OTHER",
] as const;
export const partySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    legalName: z.string().trim().min(1).max(160),
    kind: z.enum(partyKinds),
    contactEmail: z.email().max(254).nullable().default(null),
    phone: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[+0-9 ()-]+$/)
      .nullable()
      .default(null),
    address: z.string().trim().min(1).max(1000).nullable().default(null),
    userId: z.uuid().nullable().default(null),
    reason: reasonSchema,
  })
  .strict();
export const cashSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["BANK", "CASH"]),
    glAccountId: z.uuid(),
    currency: z.literal("PKR").default("PKR"),
    maskedReference: z
      .string()
      .regex(/^[0-9]{4}(?![\s\S])/, "Enter only the last four digits.")
      .nullable()
      .default(null),
    reason: reasonSchema,
  })
  .strict();
export const masterSchemas = {
  PARTY_CREATE: partySchema,
  PARTY_UPDATE: partySchema.extend({ expectedVersion: versionSchema }),
  PARTY_ARCHIVE: versionReasonSchema,
  PARTY_REACTIVATE: versionReasonSchema,
  CASH_CREATE: cashSchema,
  CASH_UPDATE: cashSchema.extend({ expectedVersion: versionSchema }),
  CASH_ARCHIVE: versionReasonSchema,
  CASH_REACTIVATE: versionReasonSchema,
};
export type MasterAction = keyof typeof masterSchemas;
export const masterQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    active: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).default("ACTIVE"),
    kind: z.enum(["ALL", ...partyKinds, "BANK", "CASH"]).default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(["name", "updated"]).default("name"),
  })
  .strict();
