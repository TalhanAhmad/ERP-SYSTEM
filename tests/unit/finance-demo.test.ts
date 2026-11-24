import { afterEach, it, expect, vi } from "vitest";
import {
  demoEnvironment,
  demoManifestSchema,
  demoPaths,
  type DemoManifest,
} from "../../scripts/finance/demo-config";
import { parseRuntime } from "@/lib/runtime-config";
const fixture: DemoManifest = {
  version: 1,
  id: "32ce6f98-6876-4ef9-9fe0-fd84fb9faefc",
  projectRoot: "/synthetic/encova",
  databasePort: 55434,
  appPort: 3102,
  providerPort: 3103,
  databasePassword: "a".repeat(48),
  runtimePassword: "b".repeat(48),
  authSecret: "c".repeat(64),
  cronSecret: "d".repeat(64),
  createdAt: "2026-11-22T00:00:00Z",
  accounts: Array.from({ length: 6 }, (_, n) => ({
    name: "Synthetic " + n,
    username: "demo." + n,
    email: `synthetic${n}@example.test`,
    role: "SUPER_ADMIN",
    password: "Synthetic-demo-password-9!",
  })),
};
afterEach(() => vi.unstubAllEnvs());
it("discards inherited production credentials, mail delivery and hosted flags from the review demo", () => {
  for (const [key, value] of Object.entries({
    DATABASE_URL: "postgresql://live:private@live.example.test/postgres",
    DIRECT_URL: "postgresql://owner:private@live.example.test/postgres",
    SUPABASE_URL: "https://live.example.test",
    SUPABASE_SECRET_KEY: "actual-provider-secret",
    DATABASE_SSL_CA: "actual-provider-ca",
    SMTP_HOST: "smtp.example.test",
    SMTP_PASSWORD: "actual-mail-secret",
    VERCEL_ENV: "production",
    FINANCE_SCANNER_SECRET: "actual-scanner-secret",
    VERCEL_TOKEN: "actual-cloud-token",
  }))
    vi.stubEnv(key, value);
  const env = demoEnvironment(fixture),
    db = new URL(env.DATABASE_URL);
  expect(db.hostname).toBe("127.0.0.1");
  expect(db.port).toBe("55434");
  expect(db.pathname).toBe("/encova_test");
  expect(db.username).toBe("encova_app");
  for (const key of [
    "DIRECT_URL",
    "DATABASE_SSL_CA",
    "SMTP_PASSWORD",
    "VERCEL_TOKEN",
    "FINANCE_SCANNER_SECRET",
  ])
    expect(env[key as keyof typeof env] ?? "").toBe("");
  expect(env.SMTP_HOST).toBe("127.0.0.1");
  expect(env.SUPABASE_SECRET_KEY).not.toBe("actual-provider-secret");
  expect(env.VERCEL_ENV).toBe("");
  expect(parseRuntime(env)).toMatchObject({
    AUTH_PROVIDER: "better-auth",
    FINANCE_ENABLED: true,
    FINANCE_DEMO: true,
  });
});
it("keeps controlled migration credentials out of the running application", () => {
  const app = demoEnvironment(fixture),
    operator = demoEnvironment(fixture, true);
  expect(new URL(app.DATABASE_URL).username).toBe("encova_app");
  expect(new URL(operator.DATABASE_URL).username).toBe("encova");
  expect(operator.DIRECT_URL).toBe(operator.DATABASE_URL);
  expect(app.DIRECT_URL).toBeUndefined();
  expect(demoPaths(fixture).database).toBe(
    "/synthetic/encova/.local/finance-demo/" + fixture.id + "/postgres",
  );
});
it("refuses malformed retained demo manifests instead of treating another connection as its database", () => {
  expect(() =>
    demoManifestSchema.parse({
      ...fixture,
      databasePassword: "x';ALTER ROLE postgres;",
    }),
  ).toThrow();
  expect(() =>
    demoManifestSchema.parse({ ...fixture, id: "../../production" }),
  ).toThrow();
  expect(() =>
    demoManifestSchema.parse({
      ...fixture,
      DATABASE_URL: "postgresql://live.example.test/postgres",
    }),
  ).toThrow();
});
it("the visual demo flag does not enable finance or select an administrator", () => {
  const local = {
    DATABASE_URL: "postgresql://local:local@localhost/encova_test",
    APP_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "Synthetic-auth-secret-at-least-32-characters",
  };
  expect(parseRuntime(local)).toMatchObject({
    FINANCE_DEMO: false,
    FINANCE_ENABLED: false,
  });
  expect(parseRuntime({ ...local, FINANCE_DEMO: "true" })).toMatchObject({
    FINANCE_DEMO: true,
    FINANCE_ENABLED: false,
  });
});

it("refuses stale or unrelated process IDs before a demo stop can signal them", async () => {
  const { isOwnedDemoProcess } =
    await import("../../scripts/finance/demo-process");
  expect(isOwnedDemoProcess(process.cwd(), process.pid)).toBe(false);
  expect(isOwnedDemoProcess(process.cwd(), 0)).toBe(false);
  expect(isOwnedDemoProcess(process.cwd(), -1)).toBe(false);
});
