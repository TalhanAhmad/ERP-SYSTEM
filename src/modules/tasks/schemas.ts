import { z } from "zod";
export const createTask = z
  .object({
    projectId: z.uuid(),
    assigneeId: z.uuid(),
    reviewerId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    dueAt: z.iso.datetime().optional(),
  })
  .strict()
  .refine((v) => v.assigneeId !== v.reviewerId, {
    message: "Reviewer must differ from assignee.",
    path: ["reviewerId"],
  });
export const submitTask = z
  .object({
    expectedVersion: z.number().int().positive(),
    summary: z.string().trim().min(1).max(5000),
    artifactLinks: z
      .array(
        z
          .url()
          .max(2048)
          .refine((s) => new URL(s).protocol === "https:", "Use HTTPS links."),
      )
      .max(10),
    attachmentIds: z
      .array(z.uuid())
      .max(10)
      .refine((v) => new Set(v).size === v.length, "Choose each file once.")
      .optional(),
  })
  .strict();
export const reviewTask = z
  .object({
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
    feedback: z.string().trim().max(2000),
    overrideReason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.decision !== "REQUEST_CHANGES" || v.feedback.length > 0, {
    message: "Feedback is required for changes.",
    path: ["feedback"],
  });
