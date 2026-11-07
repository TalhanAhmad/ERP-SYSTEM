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
const providerUser = {
  id: providerId,
  aud: "authenticated",
  role: "authenticated",
  email,
  email_confirmed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  app_metadata: { role: "SUPER_ADMIN" },
  user_metadata: { role: "SUPER_ADMIN" },
};
vi.stubGlobal(
  "fetch",
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init),
      path = new URL(request.url).pathname;
    const session = {
      access_token: token,
      refresh_token: "synthetic-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: providerUser,
    };
    if (path.endsWith("/token")) return Response.json(session);
    if (path.endsWith("/user")) {
      serverReads++;
      return providerAccepts
        ? Response.json(providerUser)
        : Response.json(
            { msg: "Invalid token", code: "bad_jwt" },
            { status: 401 },
          );
    }
    if (path.endsWith("/verify")) return Response.json(session);
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
