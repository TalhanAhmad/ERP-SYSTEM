import { z } from "zod";
export const invitationSchema = z
  .object({
    email: z.email().transform((v) => v.toLowerCase().trim()),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,30}$/),
    displayName: z.string().trim().min(1).max(120),
    role: z.enum(["MEMBER", "TEAM_LEAD", "HR_ADMIN", "SUPER_ADMIN"]),
    employmentType: z.enum(["EMPLOYEE", "INTERN"]),
  })
  .strict();
export const acceptSchema = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/),
    email: z.email().transform((v) => v.toLowerCase().trim()),
    password: z.string().min(12).max(128),
  })
  .strict();
