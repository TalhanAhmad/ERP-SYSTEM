import { z } from "zod";
export const roles = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "TEAM_LEAD",
  "MEMBER",
] as const;
const reason = z.string().trim().min(3).max(500).optional();
export const roleSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    role: z.enum(roles),
    reason,
  })
  .strict();
export const accountStatusSchema = z
  .object({ expectedVersion: z.number().int().positive(), reason })
  .strict();
export const profileSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(120),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,30}$/),
    employmentType: z.enum(["EMPLOYEE", "INTERN"]),
  })
  .strict();
export const peopleQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    status: z.enum(["ACTIVE", "INACTIVE", "INVITED", "ALL"]).default("ACTIVE"),
    role: z.enum(["ALL", ...roles]).default("ALL"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
