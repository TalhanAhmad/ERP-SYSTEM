// Real SDK + real PostgreSQL; mocked Auth HTTP contract. Not a live Supabase acceptance test.
import "dotenv/config";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required.");
vi.stubEnv("DATABASE_URL", url);
vi.stubEnv("AUTH_PROVIDER", "supabase");
vi.stubEnv("APP_URL", "http://localhost:3000");
vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54399");
vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-server-only-key");
vi.stubEnv("CRON_SECRET", "synthetic-cron-secret-at-least-32-characters");
const providerId = crypto.randomUUID(),
  suffix = providerId.slice(0, 8),
  email = `sdk.${suffix}@example.test`;
const issued = Math.floor(Date.now() / 1000);
const token = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ),
  Buffer.from(
    JSON.stringify({
      sub: providerId,
      aud: "authenticated",
      role: "authenticated",
      iat: issued,
      exp: issued + 3600,
      session_id: crypto.randomUUID(),
    }),
  ).toString("base64url"),
  "synthetic-contract-signature",
].join(".");
let providerAccepts = true,
  serverReads = 0;
let currentEmail = email,
  pendingEmail = "",
  emailUpdateCalls = 0;
const factorId = crypto.randomUUID();
let factorStatus: "verified" | "unverified" | undefined;
let upgradedToken: string | undefined;
const providerUser = {
  id: providerId,
  aud: "authenticated",
  role: "authenticated",
  get email() {
    return currentEmail;
  },
  get new_email() {
    return pendingEmail || undefined;
  },
  email_confirmed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  app_metadata: { role: "SUPER_ADMIN" },
  user_metadata: { role: "SUPER_ADMIN" },
  get factors() {
    return factorStatus
      ? [
          {
            id: factorId,
            factor_type: "totp" as const,
            status: factorStatus,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]
      : [];
  },
};
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init),
      path = new URL(request.url).pathname;
    const session = {
      access_token: upgradedToken ?? token,
      refresh_token: "synthetic-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: providerUser,
    };
    if (path.endsWith("/factors") && request.method === "POST") {
      factorStatus = "unverified";
      return Response.json({
        id: factorId,
        type: "totp",
        totp: {
          secret: "SYNTHETIC-CONTRACT-SECRET",
          qr_code: "data:image/svg+xml,synthetic",
          uri: "otpauth://totp/contract",
        },
      });
    }
    if (path.endsWith("/challenge"))
      return Response.json({
        id: crypto.randomUUID(),
        expires_at: Math.floor(Date.now() / 1000) + 300,
      });
    if (path.endsWith("/verify") && path.includes("/factors/")) {
      const input = await request.json();
      if (input.code !== "123456")
        return Response.json({ msg: "Invalid code" }, { status: 422 });
      factorStatus = "verified";
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
      upgradedToken = [
        token.split(".")[0],
        Buffer.from(JSON.stringify({ ...claims, aal: "aal2" })).toString(
          "base64url",
        ),
        token.split(".")[2],
      ].join(".");
      return Response.json({
        ...session,
        access_token: upgradedToken,
        user: providerUser,
      });
    }
    if (path.endsWith("/token")) {
      const body = await request.json();
      if (body.password === "incorrect-current-password")
        return Response.json(
          { msg: "Invalid credentials", code: "invalid_credentials" },
          { status: 400 },
        );
      return Response.json(session);
    }
    if (path.endsWith("/user")) {
      if (request.method === "PUT") {
        const body = await request.json();
        if (body.email) {
          pendingEmail = body.email;
          emailUpdateCalls++;
        }
        return Response.json(providerUser);
      }
      serverReads++;
      return providerAccepts
        ? Response.json(providerUser)
        : Response.json(
            { msg: "Invalid token", code: "bad_jwt" },
            { status: 401 },
          );
    }
    if (path.endsWith("/verify")) {
      const body = await request.json();
      if (body.type === "email_change") {
        if (body.token_hash === "expired-email-change")
          return Response.json(
            { msg: "Expired", code: "otp_expired" },
            { status: 403 },
          );
        if (body.token_hash === "email-change-first")
          return Response.json({ user: providerUser });
        if (body.token_hash === "email-change-final") {
          currentEmail = pendingEmail;
          pendingEmail = "";
          return Response.json(session);
        }
      }
      return Response.json(session);
    }
    if (path.endsWith("/recover"))
      return Response.json({ msg: "Account does not exist" }, { status: 400 });
    if (path.endsWith("/logout")) return Response.json({});
    return Response.json({ msg: "Unexpected contract URL" }, { status: 404 });
  }),
);
const { db } = await import("@/server/db");
const { authAction, confirmSupabase } = await import("@/server/identity-http");
const { context } = await import("@/server/context");
const legacy = await import("@/app/api/auth/[...all]/route");
let person: Awaited<ReturnType<typeof db.person.create>>, cookie: string;
beforeAll(async () => {
  person = await db.person.create({
    data: {
      supabaseUserId: providerId,
      email,
      username: `sdk.${suffix}`,
      displayName: "SDK contract fixture",
      role: "MEMBER",
      status: "ACTIVE",
    },
  });
});
afterAll(async () => {
  await db.$disconnect();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/session/sign-in", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-encova-csrf": "1",
    },
    body: JSON.stringify(body),
  });
}
it("uses the SDK to sign in and returns only a safe DTO with HTTP-only SSR cookies", async () => {
  const response = await authAction(
    "sign-in",
    request({ email, password: "Synthetic-test-password-only-8#" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { success: true } });
  const headers = response.headers.getSetCookie();
  expect(headers.some((c) => /httponly/i.test(c))).toBe(true);
  expect(response.headers.get("cache-control")).toContain("no-store");
  cookie = headers.map((c) => c.split(";")[0]).join("; ");
});
it("verifies the provider session and loads the current domain role rather than metadata", async () => {
  const actor = await context(new Headers({ cookie }));
  expect(actor.id).toBe(person.id);
  expect(actor.role).toBe("MEMBER");
  expect(serverReads).toBeGreaterThan(0);
});
it("rejects cookies when the Auth server rejects their token", async () => {
  providerAccepts = false;
  try {
    await expect(context(new Headers({ cookie }))).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  } finally {
    providerAccepts = true;
  }
});
it("denies application access immediately after domain deactivation despite a provider token", async () => {
  await db.person.update({
    where: { id: person.id },
    data: { status: "INACTIVE" },
  });
  await expect(context(new Headers({ cookie }))).rejects.toMatchObject({
    code: "ACCOUNT_INACTIVE",
  });
  await db.person.update({
    where: { id: person.id },
    data: { status: "ACTIVE" },
  });
});
it("does not expose the legacy registration endpoint in Supabase mode", async () => {
  expect(
    (
      await legacy.POST(
        request({ email, password: "Synthetic-test-password-only-8#" }),
      )
    ).status,
  ).toBe(404);
});
it("rejects a mutation from another origin", async () => {
  expect(
    (
      await authAction(
        "sign-in",
        request(
          { email, password: "Synthetic-test-password-only-8#" },
          "https://evil.example",
        ),
      )
    ).status,
  ).toBe(403);
});
it("returns generic reset responses even when Auth reports an unknown account", async () => {
  const response = await authAction(
    "password-reset",
    request({ email: "unknown@example.test" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { success: true } });
});
it("does not allow an external callback redirect", async () => {
  const response = await confirmSupabase(
    new Request(
      "http://localhost:3000/auth/confirm?token_hash=synthetic&type=recovery&next=https://evil.example",
    ),
  );
  expect(response.headers.get("location")).toBe(
    "http://localhost:3000/reset-password",
  );
});
it("refuses scheduler requests without its machine credential", async () => {
  const { GET } = await import("@/app/api/internal/jobs/route");
  expect(
    (await GET(new Request("http://localhost:3000/api/internal/jobs"))).status,
  ).toBe(401);
});
function securityRequest(body: unknown, cookies = cookie) {
  return new Request("http://localhost:3000/api/security", {
    method: "POST",
    headers: {
      cookie: cookies,
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-encova-csrf": "1",
    },
    body: JSON.stringify(body),
  });
}
it("enrolls and verifies provider TOTP without exposing tokens, then blocks an AAL1 session", async () => {
  const { securityAction } = await import("@/server/security-http");
  const enroll = await securityAction(securityRequest({ action: "enroll" }));
  expect(enroll.status).toBe(200);
  expect(enroll.headers.get("cache-control")).toContain("no-store");
  const setup = await enroll.json();
  expect(setup.data.id).toBe(factorId);
  expect(setup.data).not.toHaveProperty("access_token");
  const invalid = await securityAction(
    securityRequest({ action: "verify", factorId, code: "000000" }),
  );
  expect(invalid.status).toBe(422);
  const verified = await securityAction(
    securityRequest({ action: "verify", factorId, code: "123456" }),
  );
  expect(verified.status).toBe(200);
  await expect(context(new Headers({ cookie }))).rejects.toMatchObject({
    code: "MFA_REQUIRED",
  });
  expect(
    (await context(new Headers({ cookie }), { allowSecurity: true })).id,
  ).toBe(person.id);
  const changed = verified.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect((await context(new Headers({ cookie: changed }))).id).toBe(person.id);
  expect(
    await db.audit.count({
      where: {
        actorId: person.id,
        changes: { string_contains: "SYNTHETIC-CONTRACT-SECRET" },
      },
    }),
  ).toBe(0);
  // Exercise policy changes only in the isolated test database and restore them.
  const settings = await db.companySettings.findUniqueOrThrow({
    where: { id: "workspace" },
  });
  await db.person.update({
    where: { id: person.id },
    data: { role: "SUPER_ADMIN" },
  });
  try {
    const enabled = await securityAction(
      securityRequest(
        { action: "policy", expectedVersion: settings.version, required: true },
        changed,
      ),
    );
    expect(enabled.status).toBe(200);
    expect(
      (
        await db.companySettings.findUniqueOrThrow({
          where: { id: "workspace" },
        })
      ).requirePrivilegedMfa,
    ).toBe(true);
    const disabled = await securityAction(
      securityRequest(
        {
          action: "policy",
          expectedVersion: settings.version + 1,
          required: settings.requirePrivilegedMfa,
        },
        changed,
      ),
    );
    expect(disabled.status).toBe(200);
  } finally {
    await db.companySettings.update({
      where: { id: "workspace" },
      data: { requirePrivilegedMfa: settings.requirePrivilegedMfa },
    });
    await db.person.update({
      where: { id: person.id },
      data: { role: "MEMBER" },
    });
  }
  // Retire only contract state; the hosted policy is untouched.
  factorStatus = undefined;
  upgradedToken = undefined;
});
it("rejects arbitrary factor IDs and prevents non-admin MFA-policy changes", async () => {
  const { securityAction } = await import("@/server/security-http");
  expect(
    (
      await securityAction(
        securityRequest({
          action: "verify",
          factorId: crypto.randomUUID(),
          code: "123456",
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await securityAction(
        securityRequest({
          action: "policy",
          expectedVersion: 1,
          required: true,
        }),
      )
    ).status,
  ).toBe(403);
});

it("keeps email changes disabled for restricted delivery without sending provider mail", async () => {
  const { securityAction } = await import("@/server/security-http");
  const before = emailUpdateCalls;
  expect(
    (
      await securityAction(
        securityRequest({
          action: "email-change",
          email: `next.${suffix}@example.test`,
          password: "Synthetic-test-password-only-8#",
        }),
      )
    ).status,
  ).toBe(409);
  expect(emailUpdateCalls).toBe(before);
});
it("requires current-password and MFA reauthentication before an own-email change", async () => {
  const { securityAction } = await import("@/server/security-http"),
    { env } = await import("@/server/env");
  env.EMAIL_CHANGE_ENABLED = true;
  for (const [k, v] of Object.entries({
    SMTP_HOST: "localhost",
    SMTP_PORT: "1025",
    SMTP_FROM: "workspace@example.test",
    SMTP_TEST_RECIPIENT: "",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
  }))
    vi.stubEnv(k, v);
  await db.rateLimit.deleteMany({
    where: { id: { startsWith: "security:" + person.id } },
  });
  const before = emailUpdateCalls;
  expect(
    (
      await securityAction(
        securityRequest({
          action: "email-change",
          email: `next.${suffix}@example.test`,
          password: "incorrect-current-password",
        }),
      )
    ).status,
  ).toBe(403);
  expect(emailUpdateCalls).toBe(before);
  factorStatus = "verified";
  expect(
    (
      await securityAction(
        securityRequest({
          action: "email-change",
          email: `next.${suffix}@example.test`,
          password: "Synthetic-test-password-only-8#",
        }),
      )
    ).status,
  ).toBe(403);
  expect(emailUpdateCalls).toBe(before);
  factorStatus = undefined;
  const r = await securityAction(
    securityRequest({
      action: "email-change",
      email: `next.${suffix}@example.test`,
      password: "Synthetic-test-password-only-8#",
    }),
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ data: { pending: true } });
  expect(r.headers.get("cache-control")).toContain("no-store");
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: person.id } })).email,
  ).toBe(email);
  expect(pendingEmail).toBe(`next.${suffix}@example.test`);
  env.EMAIL_CHANGE_ENABLED = false;
});
it("handles first/final/expired email confirmations safely, preserves domain identity and revokes other app sessions", async () => {
  const otherSession = crypto.randomUUID();
  await db.appSession.create({ data: { id: otherSession, userId: person.id } });
  const before = (
    await db.person.findUniqueOrThrow({ where: { id: person.id } })
  ).version;
  const callback = (hash: string) =>
    confirmSupabase(
      new Request(
        "http://localhost:3000/auth/confirm?flow=email-change&type=email_change&next=https://evil.example&token_hash=" +
          hash,
      ),
    );
  const first = await callback("email-change-first");
  expect(first.headers.get("location")).toBe(
    "http://localhost:3000/email-change?state=pending",
  );
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: person.id } })).email,
  ).toBe(email);
  expect((await callback("expired-email-change")).headers.get("location")).toBe(
    "http://localhost:3000/email-change?state=failed",
  );
  const final = await callback("email-change-final");
  expect(final.headers.get("location")).toBe(
    "http://localhost:3000/email-change?state=complete",
  );
  const stored = await db.person.findUniqueOrThrow({
    where: { id: person.id },
  });
  expect(stored.email).toBe(`next.${suffix}@example.test`);
  expect(stored.version).toBe(before + 1);
  expect(stored.supabaseUserId).toBe(providerId);
  expect(
    await db.appSession.findUnique({ where: { id: otherSession } }),
  ).toBeNull();
  const actor = await context(new Headers({ cookie }));
  expect(actor.id).toBe(person.id);
  expect(actor.email).toBe(stored.email);
  expect(
    await db.audit.count({
      where: { actorId: person.id, action: "LOGIN_EMAIL_VERIFIED" },
    }),
  ).toBe(1);
});
it("serializes two verified-email synchronizations without duplicate audits or loss of work", async () => {
  const current = await db.person.findUniqueOrThrow({
    where: { id: person.id },
  });
  const project = await db.project.create({
    data: {
      name: "Email continuity " + suffix,
      description: "Synthetic",
      managerId: person.id,
    },
  });
  currentEmail = `third.${suffix}@example.test`;
  const results = await Promise.all([
    context(new Headers({ cookie })),
    context(new Headers({ cookie })),
  ]);
  expect(results.map((p) => p.email)).toEqual([currentEmail, currentEmail]);
  const updated = await db.person.findUniqueOrThrow({
    where: { id: person.id },
  });
  expect(updated.version).toBe(current.version + 1);
  expect(
    (await db.project.findUniqueOrThrow({ where: { id: project.id } }))
      .managerId,
  ).toBe(person.id);
  expect(
    await db.audit.count({
      where: { actorId: person.id, action: "LOGIN_EMAIL_VERIFIED" },
    }),
  ).toBe(2);
  await db.project.update({
    where: { id: project.id },
    data: { archivedAt: new Date() },
  });
});
it("refuses verified-email collisions without overwriting either person or reviving sessions", async () => {
  const { synchronizeLoginEmail } = await import("@/server/login-email");
  const other = await db.person.create({
    data: {
      username: "sdk.other." + suffix,
      email: "collision." + suffix + "@example.test",
      displayName: "Email collision fixture",
      status: "ACTIVE",
    },
  });
  const current = await db.person.findUniqueOrThrow({
    where: { id: person.id },
  });
  await expect(
    db.$transaction((tx) =>
      synchronizeLoginEmail(
        tx,
        current,
        { ...providerUser, email: other.email },
        crypto.randomUUID(),
      ),
    ),
  ).rejects.toMatchObject({ code: "EMAIL_LINK_CONFLICT" });
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: person.id } })).email,
  ).toBe(current.email);
  await db.person.update({
    where: { id: other.id },
    data: { status: "INACTIVE" },
  });
});
it("revokes app access immediately on all-device logout despite an otherwise accepted provider JWT", async () => {
  const { securityAction } = await import("@/server/security-http");
  expect(
    (await securityAction(securityRequest({ action: "sign-out-all" }))).status,
  ).toBe(200);
  await expect(context(new Headers({ cookie }))).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(await db.appSession.count({ where: { userId: person.id } })).toBe(0);
  const signed = await authAction(
    "sign-in",
    request({ email, password: "Synthetic-test-password-only-8#" }),
  );
  expect(signed.status).toBe(200);
  cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
});
it("clears the SDK session cookie on server-side sign-out", async () => {
  const response = await authAction(
    "sign-out",
    new Request("http://localhost:3000/api/session/sign-out", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
        "x-encova-csrf": "1",
      },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  expect(
    response.headers.getSetCookie().some((value) => /max-age=0/i.test(value)),
  ).toBe(true);
});
