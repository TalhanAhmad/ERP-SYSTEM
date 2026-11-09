import { z } from "zod";
export const assignmentQuerySchema = z
  .object({
    view: z.enum(["all", "open", "review", "approved"]).default("all"),
    q: z.string().trim().max(100).default(""),
    project: z.union([z.uuid(), z.literal("")]).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export type AssignmentQuery = z.infer<typeof assignmentQuerySchema>;
