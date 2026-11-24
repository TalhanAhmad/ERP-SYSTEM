import path from "node:path";
import { z } from "zod";
const accountSchema = z
  .object({
    name: z.string(),
    email: z.email(),
    username: z.string(),
    role: z.enum(["SUPER_ADMIN", "HR_ADMIN", "TEAM_LEAD", "MEMBER"]),
    password: z.string().min(16),
    supabaseUserId: z.uuid().optional(),
  })
  .strict();
export const demoManifestSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    projectRoot: z.string(),
    databasePort: z.number().int().min(1024).max(65535),
    appPort: z.number().int().min(1024).max(65535),
    providerPort: z.number().int().min(1024).max(65535),
    databasePassword: z.string().regex(/^[a-f0-9]{48}$/),
    runtimePassword: z.string().regex(/^[a-f0-9]{48}$/),
    authSecret: z.string().min(32),
    cronSecret: z.string().min(32),
    createdAt: z.string(),
    accounts: z.array(accountSchema).length(6),
  })
  .strict();
export type DemoManifest = z.infer<typeof demoManifestSchema>;
export function demoPaths(m: DemoManifest) {
  const root = path.join(m.projectRoot, ".local", "finance-demo", m.id);
  return {
    root,
    database: path.join(root, "postgres"),
    app: path.join(root, "app"),
    fixture: path.join(root, "fixture.json"),
  };
}
export function demoEnvironment(m: DemoManifest, operator = false) {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  // Do not inherit cloud, database or mail credentials from the current shell/project.
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "SystemRoot",
  ])
    if (process.env[key]) environment[key] = process.env[key];
  const url = new URL(
    `postgresql://${operator ? "encova" : "encova_app"}@127.0.0.1:${m.databasePort}/encova_test`,
  );
  url.password = operator ? m.databasePassword : m.runtimePassword;
  return {
    ...environment,
    DATABASE_URL: url.toString(),
    ...(operator
      ? { DIRECT_URL: url.toString(), TEST_DATABASE_URL: url.toString() }
      : {}),
    APP_URL: `http://localhost:${m.appPort}`,
    BETTER_AUTH_URL: `http://localhost:${m.appPort}`,
    AUTH_PROVIDER: "better-auth",
    BETTER_AUTH_SECRET: m.authSecret,
    FINANCE_ENABLED: "true",
    FINANCE_DEMO: "true",
    EMAIL_CHANGE_ENABLED: "false",
    VERCEL_ENV: "",
    DATABASE_POOL_MAX: "2",
    SUPABASE_URL: `http://127.0.0.1:${m.providerPort}`,
    SUPABASE_PUBLISHABLE_KEY: "synthetic-demo-publishable-key",
    SUPABASE_SECRET_KEY: "synthetic-demo-server-only-key",
    SUPABASE_STORAGE_BUCKET: "encova-finance-demo",
    CRON_SECRET: m.cronSecret,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "9",
    SMTP_FROM: "demo@example.test",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_TEST_RECIPIENT: "demo@example.test",
    ENCOVA_DEMO_ROOT: m.projectRoot,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
