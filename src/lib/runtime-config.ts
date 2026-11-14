import { z } from "zod";
function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
const postgres = z
  .url()
  .refine(
    (v) => ["postgres:", "postgresql:"].includes(safeUrl(v)?.protocol ?? ""),
    "A PostgreSQL URL is required.",
  );
export const runtimeSchema = z
  .object({
    DATABASE_URL: postgres,
    DIRECT_URL: postgres.optional(),
    DATABASE_SSL_CA: z.string().min(1).optional(),
    APP_URL: z.url().optional(),
    FINANCE_SCANNER_URL: z.url().optional(),
    FINANCE_SCANNER_SECRET: z.string().min(32).optional(),
    FINANCE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    EMAIL_CHANGE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    AUTH_PROVIDER: z.enum(["better-auth", "supabase"]).default("better-auth"),
    BETTER_AUTH_URL: z.url().optional(),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(10).optional(),
    SUPABASE_SECRET_KEY: z.string().min(10).optional(),
    SUPABASE_STORAGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default("encova-private"),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(10).default(2),
    CRON_SECRET: z.string().min(32).optional(),
    VERCEL_ENV: z.string().optional(),
  })
  .superRefine((v, c) => {
    if (v.FINANCE_SCANNER_URL) {
      const url = new URL(v.FINANCE_SCANNER_URL);
      const local =
        ["localhost", "127.0.0.1"].includes(url.hostname) && !v.VERCEL_ENV;
      if (url.username || url.password || (url.protocol !== "https:" && !local))
        c.addIssue({
          code: "custom",
          path: ["FINANCE_SCANNER_URL"],
          message:
            "Use a configured HTTPS scanner endpoint without embedded credentials.",
        });
    }
    if (!v.APP_URL && !v.BETTER_AUTH_URL)
      c.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "Set the canonical application URL.",
      });
    if (
      v.AUTH_PROVIDER === "better-auth" &&
      (!v.BETTER_AUTH_SECRET || v.BETTER_AUTH_SECRET.startsWith("replace-"))
    )
      c.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "Generate a random development auth secret.",
      });
    if (v.AUTH_PROVIDER === "supabase")
      for (const key of [
        "SUPABASE_URL",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
      ] as const)
        if (!v[key])
          c.addIssue({
            code: "custom",
            path: [key],
            message: "Required for Supabase Auth.",
          });
    if (v.VERCEL_ENV === "production" || v.VERCEL_ENV === "preview") {
      if (
        ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
          safeUrl(v.DATABASE_URL)?.hostname ?? "",
        )
      )
        c.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "Hosted functions require a hosted database.",
        });
      if (v.AUTH_PROVIDER !== "supabase")
        c.addIssue({
          code: "custom",
          path: ["AUTH_PROVIDER"],
          message: "Vercel deployments require Supabase Auth.",
        });
      if (!v.APP_URL?.startsWith("https://"))
        c.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "Production requires a canonical HTTPS origin.",
        });
      if (!v.CRON_SECRET)
        c.addIssue({
          code: "custom",
          path: ["CRON_SECRET"],
          message: "Configure the authenticated job endpoint.",
        });
      if (v.SUPABASE_URL && !v.SUPABASE_URL.startsWith("https://"))
        c.addIssue({
          code: "custom",
          path: ["SUPABASE_URL"],
          message: "Production Supabase requires HTTPS.",
        });
    }
  });
export function parseRuntime(input: Record<string, unknown>) {
  const result = runtimeSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      `Invalid server configuration: ${[...new Set(result.error.issues.map((i) => i.path.join(".")))].join(", ")}. See .env.example.`,
    );
  return {
    ...result.data,
    APP_URL: result.data.APP_URL ?? result.data.BETTER_AUTH_URL!,
  };
}
