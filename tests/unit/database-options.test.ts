import { describe, it, expect } from "vitest";
import { databaseOptions } from "@/lib/database-options";
describe("Verified provider TLS configuration", () => {
  it("preserves unmodified local development configuration", () => {
    const url = "postgresql://local:local@localhost:5432/encova_dev";
    expect(databaseOptions(url).connectionString).toBe(url);
    expect(databaseOptions(url).ssl).toBeUndefined();
  });
  it.each(["disable", "require", "verify-full"])(
    "prevents URL sslmode=%s from replacing the trusted CA",
    (mode) => {
      const result = databaseOptions(
        `postgresql://app:private@db.example.test:6543/postgres?sslmode=${mode}&application_name=encova`,
        2,
        "public-test-ca",
      );
      expect(
        new URL(result.connectionString!).searchParams.has("sslmode"),
      ).toBe(false);
      expect(
        new URL(result.connectionString!).searchParams.get("application_name"),
      ).toBe("encova");
      expect(result.ssl).toEqual({
        ca: "public-test-ca",
        rejectUnauthorized: true,
      });
    },
  );
  it("retains a bounded connection pool with custom TLS", () =>
    expect(
      databaseOptions(
        "postgresql://app:private@db.example.test/postgres",
        2,
        "public-test-ca",
      ).max,
    ).toBe(2));
});
