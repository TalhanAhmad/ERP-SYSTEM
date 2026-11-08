import { z } from "zod";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const schema = z
  .object({
    SMTP_HOST: z
      .string()
      .trim()
      .min(1)
      .refine((v) => !/[\s/@]/.test(v)),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_FROM: z.email(),
    SMTP_TEST_RECIPIENT: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.email().optional(),
    ),
    SMTP_USER: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(1).optional(),
    ),
    SMTP_PASSWORD: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(1).optional(),
    ),
    VERCEL_ENV: z.string().optional(),
  })
  .refine((v) => Boolean(v.SMTP_USER) === Boolean(v.SMTP_PASSWORD))
  .refine(
    (v) =>
      v.SMTP_HOST.toLowerCase() !== "smtp.resend.com" ||
      v.SMTP_FROM.split("@")[1]?.toLowerCase() !== "resend.dev" ||
      Boolean(v.SMTP_TEST_RECIPIENT),
  )
  .refine(
    (v) =>
      !["production", "preview"].includes(v.VERCEL_ENV ?? "") ||
      !localHosts.has(v.SMTP_HOST.toLowerCase()),
  );
export function emailStatus(input: Record<string, unknown> = process.env) {
  if (
    ![
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_FROM",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "SMTP_TEST_RECIPIENT",
    ].some((k) => input[k] !== undefined && input[k] !== "")
  )
    return "NOT_CONFIGURED" as const;
  return schema.safeParse(input).success
    ? ("READY" as const)
    : ("INVALID" as const);
}
export function emailTestMode(input: Record<string, unknown> = process.env) {
  const parsed = schema.safeParse(input);
  return parsed.success && Boolean(parsed.data.SMTP_TEST_RECIPIENT);
}
export function smtpConfiguration(
  input: Record<string, unknown> = process.env,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new Error("SMTP configuration is missing or invalid.");
  const v = parsed.data;
  const options: SMTPTransport.Options = {
    host: v.SMTP_HOST,
    port: v.SMTP_PORT,
    secure: v.SMTP_PORT === 465,
    requireTLS: !localHosts.has(v.SMTP_HOST.toLowerCase()),
    tls: { rejectUnauthorized: true },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(v.SMTP_USER
      ? { auth: { user: v.SMTP_USER, pass: v.SMTP_PASSWORD } }
      : {}),
  };
  return { options, from: v.SMTP_FROM, testRecipient: v.SMTP_TEST_RECIPIENT };
}
