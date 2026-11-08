import { describe, it, expect } from "vitest";
import {
  emailStatus,
  emailTestMode,
  smtpConfiguration,
} from "@/lib/email-config";
const hosted = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: 587,
  SMTP_FROM: "workspace@example.test",
  SMTP_USER: "fixture",
  SMTP_PASSWORD: "synthetic-password",
  VERCEL_ENV: "production",
};
describe("SMTP configuration boundaries", () => {
  it("requires an explicit test inbox for Resend's restricted default sender", () => {
    const config = {
      ...hosted,
      SMTP_HOST: "smtp.resend.com",
      SMTP_FROM: "onboarding@resend.dev",
    };
    expect(emailStatus(config)).toBe("INVALID");
    expect(
      emailStatus({ ...config, SMTP_TEST_RECIPIENT: "owner@example.test" }),
    ).toBe("READY");
    expect(
      emailTestMode({ ...config, SMTP_TEST_RECIPIENT: "owner@example.test" }),
    ).toBe(true);
    expect(emailTestMode(hosted)).toBe(false);
    expect(emailStatus({ ...config, SMTP_FROM: "malformed-address" })).toBe(
      "INVALID",
    );
  });
  it("reports absent credentials without trying to send", () =>
    expect(emailStatus({})).toBe("NOT_CONFIGURED"));
  it("requires complete settings and paired credentials", () => {
    expect(emailStatus({ SMTP_HOST: "smtp.example.test" })).toBe("INVALID");
    expect(emailStatus({ ...hosted, SMTP_PASSWORD: undefined })).toBe(
      "INVALID",
    );
    expect(emailStatus({ ...hosted, SMTP_USER: undefined })).toBe("INVALID");
  });
  it("requires TLS and certificate validation for remote SMTP", () => {
    const { options } = smtpConfiguration(hosted);
    expect(options.requireTLS).toBe(true);
    expect(options.tls?.rejectUnauthorized).toBe(true);
    expect(options.secure).toBe(false);
  });
  it("uses implicit TLS on port 465", () =>
    expect(
      smtpConfiguration({ ...hosted, SMTP_PORT: 465 }).options.secure,
    ).toBe(true));
  it("allows a local unauthenticated test relay and empty optional auth fields", () => {
    const config = {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: 1025,
      SMTP_FROM: hosted.SMTP_FROM,
      SMTP_USER: "",
      SMTP_PASSWORD: "",
    };
    expect(emailStatus(config)).toBe("READY");
    expect(smtpConfiguration(config).options.requireTLS).toBe(false);
    expect(smtpConfiguration(config).options.auth).toBeUndefined();
  });
  it("rejects local SMTP settings on hosted deployments", () =>
    expect(emailStatus({ ...hosted, SMTP_HOST: "localhost" })).toBe("INVALID"));
  it("does not expose credential values in configuration errors", () =>
    expect(() => smtpConfiguration({ ...hosted, SMTP_PORT: 0 })).toThrow(
      "SMTP configuration is missing or invalid.",
    ));
});
