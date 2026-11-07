import "server-only";
import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (v) => ["postgres:", "postgresql:"].includes(new URL(v).protocol),
      "PostgreSQL connection URL required.",
    ),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine(
      (v) => !v.startsWith("replace-"),
      "Generate a private random auth secret.",
    ),
});
const result = schema.safeParse(process.env);
if (!result.success)
  throw new Error(
    "Invalid server configuration. Set DATABASE_URL, BETTER_AUTH_URL and a random BETTER_AUTH_SECRET (32+ characters).",
  );
export const env = result.data;
