import { z } from "zod";
export const projectQuerySchema = z
  .object({
    status: z.enum(["all", "active", "archived"]).default("active"),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
