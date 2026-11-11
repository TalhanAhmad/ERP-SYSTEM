import { describe, it, expect } from "vitest";
import { parseRuntime } from "@/lib/runtime-config";
import { isCronAuthorized } from "@/server/jobs/authorization";
const local = {
  DATABASE_URL: "postgresql://local:local@localhost:5432/encova_dev",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "synthetic-development-secret-with-32-chars",
};
const production = {
  DATABASE_URL:
    "postgresql://encova_app.ref:private@region.pooler.supabase.com:6543/postgres",
  APP_URL: "https://workspace.example.test",
  AUTH_PROVIDER: "supabase",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_only",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic_only",
  CRON_SECRET: "synthetic-cron-secret-at-least-32-characters",
  VERCEL_ENV: "production",
};
describe("Deployment configuration boundaries", () => {
  it("preserves explicit local development compatibility", () =>
    expect(parseRuntime(local).AUTH_PROVIDER).toBe("better-auth"));
  it("accepts Supabase production without deploying migration credentials to functions", () =>
    expect(parseRuntime(production).AUTH_PROVIDER).toBe("supabase"));
  it("rejects legacy authentication on Vercel production", () =>
    expect(() =>
      parseRuntime({ ...local, VERCEL_ENV: "production" }),
    ).toThrow());
  it("also rejects legacy auth on hosted previews", () =>
    expect(() => parseRuntime({ ...local, VERCEL_ENV: "preview" })).toThrow());
  it("refuses a local database in hosted configuration", () =>
    expect(() =>
      parseRuntime({ ...production, DATABASE_URL: local.DATABASE_URL }),
    ).toThrow("DATABASE_URL"));
  it("requires all provider keys", () =>
    expect(() =>
      parseRuntime({ ...production, SUPABASE_SECRET_KEY: undefined }),
    ).toThrow("SUPABASE_SECRET_KEY"));
  it("rejects insecure production origins", () =>
    expect(() =>
      parseRuntime({ ...production, APP_URL: "http://workspace.example.test" }),
    ).toThrow("APP_URL"));
  it("caps each function instance database pool", () =>
    expect(() =>
      parseRuntime({ ...production, DATABASE_POOL_MAX: 200 }),
    ).toThrow("DATABASE_POOL_MAX"));
  it("does not include credential values in validation errors", () => {
    try {
      parseRuntime({
        ...local,
        DATABASE_URL: "super-private-invalid-connection",
      });
    } catch (error) {
      expect(String(error)).not.toContain("super-private-invalid-connection");
    }
  });
});
describe("Scheduler authentication", () => {
  const secret = production.CRON_SECRET;
  it("requires the configured bearer secret", () =>
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true));
  it.each([null, "", "Bearer wrong", "Basic someone"])("rejects %s", (header) =>
    expect(isCronAuthorized(header, secret)).toBe(false),
  );
  it("refuses an unconfigured or short secret", () => {
    expect(isCronAuthorized("Bearer short", "short")).toBe(false);
    expect(isCronAuthorized("Bearer value", undefined)).toBe(false);
  });
});

it("sanitizes invalid hosted database URLs without echoing credentials", () => {
  expect(() =>
    parseRuntime({
      ...production,
      DATABASE_URL: "private-credential-invalid-url",
    }),
  ).toThrow("Invalid server configuration: DATABASE_URL");
});

it("keeps login email changes disabled unless explicitly enabled", () => {
  expect(parseRuntime(production).EMAIL_CHANGE_ENABLED).toBe(false);
  expect(
    parseRuntime({ ...production, EMAIL_CHANGE_ENABLED: "true" })
      .EMAIL_CHANGE_ENABLED,
  ).toBe(true);
  expect(() =>
    parseRuntime({ ...production, EMAIL_CHANGE_ENABLED: "yes" }),
  ).toThrow("EMAIL_CHANGE_ENABLED");
});

it("keeps finance disabled for both local and hosted configurations by default", () => {
  expect(parseRuntime(local).FINANCE_ENABLED).toBe(false);
  expect(parseRuntime(production).FINANCE_ENABLED).toBe(false);
  expect(
    parseRuntime({ ...local, FINANCE_ENABLED: "true" }).FINANCE_ENABLED,
  ).toBe(true);
});

it("rejects ambiguous finance flag values instead of enabling a private module", () => {
  for (const value of ["yes", "1", "TRUE", true, 1]) {
    expect(() => parseRuntime({ ...local, FINANCE_ENABLED: value })).toThrow(
      "FINANCE_ENABLED",
    );
  }
});
