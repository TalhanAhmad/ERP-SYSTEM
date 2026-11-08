import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import "server-only";
import { NextResponse } from "next/server";
import { parseCookieHeader, type CookieOptions } from "@supabase/ssr";
import { z } from "zod";
import { createHash } from "node:crypto";
import { env } from "./env";
import { db } from "./db";
import { getLegacyAuth } from "./auth";
import { supabaseWithCookies } from "./supabase/client";
import { failure, jsonBody, mutationOrigin, rateLimit } from "./http";
import { invariant } from "./errors";
export type AuthAction =
  "sign-in" | "sign-out" | "password-reset" | "password-update";
const email = z.email().transform((v) => v.trim().toLowerCase());
function cookieSession(request: Request) {
  const values = new Map(
    parseCookieHeader(request.headers.get("cookie") ?? "").flatMap((c) =>
      typeof c.value === "string" ? [[c.name, c.value] as const] : [],
    ),
  );
  const writes: { name: string; value: string; options: CookieOptions }[] = [];
  const cache: Record<string, string> = {};
  const client = supabaseWithCookies({
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    setAll: (changes, headers) => {
      changes.forEach((c) => {
        values.set(c.name, c.value);
        writes.push(c);
      });
      Object.assign(cache, headers);
    },
  });
  return {
    client,
    finish(response: NextResponse) {
      writes.forEach((c) => response.cookies.set(c.name, c.value, c.options));
      Object.entries(cache).forEach(([k, v]) => response.headers.set(k, v));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  };
}
export async function authAction(action: AuthAction, request: Request) {
  const requestId = crypto.randomUUID();
  let finish = (r: NextResponse) => r;
  try {
    mutationOrigin(request);
    const input = await jsonBody(request);
    if (action === "sign-in") {
      const body = z
        .object({ email, password: z.string().min(1).max(128) })
        .strict()
        .parse(input);
      await rateLimit(
        `login:${createHash("sha256").update(body.email).digest("hex")}`,
        10,
      );
      if (env.AUTH_PROVIDER === "supabase") {
        const session = cookieSession(request);
        finish = session.finish;
        const result = await session.client.auth.signInWithPassword(body);
        invariant(
          !result.error && result.data.user?.email_confirmed_at,
          "INVALID_LOGIN",
          "Unable to sign in. Check your credentials and account status.",
          401,
        );
        const linked = await db.person.findUnique({
          where: { supabaseUserId: result.data.user.id },
        });
        if (linked?.status !== "ACTIVE") {
          await session.client.auth.signOut({ scope: "local" });
          invariant(
            false,
            "INVALID_LOGIN",
            "Unable to sign in. Check your credentials and account status.",
            401,
          );
        }
      } else {
        const result = await getLegacyAuth().api.signInEmail({
          body,
          headers: request.headers,
          asResponse: true,
        });
        invariant(
          result.ok,
          "INVALID_LOGIN",
          "Unable to sign in. Check your credentials and account status.",
          result.status === 429 ? 429 : 401,
        );
        const response = NextResponse.json({ data: { success: true } });
        result.headers
          .getSetCookie()
          .forEach((value) => response.headers.append("set-cookie", value));
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      }
    } else if (action === "sign-out") {
      z.object({}).strict().parse(input);
      if (env.AUTH_PROVIDER === "supabase") {
        const session = cookieSession(request);
        finish = session.finish;
        const result = await session.client.auth.signOut({ scope: "local" });
        invariant(
          !result.error,
          "AUTH_UNAVAILABLE",
          "Unable to sign out. Try again.",
          503,
        );
      } else {
        const result = await getLegacyAuth().api.signOut({
          headers: request.headers,
          asResponse: true,
        });
        const response = NextResponse.json({ data: { success: true } });
        result.headers
          .getSetCookie()
          .forEach((value) => response.headers.append("set-cookie", value));
        return response;
      }
    } else if (action === "password-reset") {
      const body = z.object({ email }).strict().parse(input);
      await rateLimit("password-reset", 20);
      if (env.AUTH_PROVIDER === "supabase") {
        const session = cookieSession(request);
        finish = session.finish;
        await session.client.auth.resetPasswordForEmail(body.email, {
          redirectTo: `${env.APP_URL}/auth/confirm?next=/reset-password`,
        });
      } else
        await getLegacyAuth().api.requestPasswordReset({
          body: {
            email: body.email,
            redirectTo: `${env.APP_URL}/reset-password`,
          },
        });
      // Same response for missing accounts, delivery failures, and eligible accounts.
    } else {
      const body = z
        .object({
          password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
          token: z.string().optional(),
        })
        .strict()
        .parse(input);
      if (env.AUTH_PROVIDER === "supabase") {
        const session = cookieSession(request);
        finish = session.finish;
        const { data, error } = await session.client.auth.getUser();
        invariant(
          !error && data.user?.email_confirmed_at,
          "INVALID_RESET",
          "This reset session is invalid or expired.",
          401,
        );
        const result = await session.client.auth.updateUser({
          password: body.password,
        });
        invariant(
          !result.error,
          "INVALID_RESET",
          "Password could not be updated. Request a new reset link.",
          422,
        );
      } else {
        invariant(body.token, "INVALID_RESET", "A reset token is required.");
        await getLegacyAuth().api.resetPassword({
          body: { token: body.token, newPassword: body.password },
        });
      }
    }
    return finish(NextResponse.json({ data: { success: true } }));
  } catch (error) {
    return finish(failure(error, requestId));
  }
}
export async function confirmSupabase(request: Request) {
  if (env.AUTH_PROVIDER !== "supabase")
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Endpoint not found." } },
      { status: 404 },
    );
  const session = cookieSession(request),
    url = new URL(request.url);
  const code = url.searchParams.get("code"),
    hash = url.searchParams.get("token_hash");
  const result = code
    ? await session.client.auth.exchangeCodeForSession(code)
    : hash && url.searchParams.get("type") === "recovery"
      ? await session.client.auth.verifyOtp({
          token_hash: hash,
          type: "recovery",
        })
      : { error: true };
  const next = url.searchParams.get("next");
  const destination = result.error
    ? "/forgot-password"
    : next === "/dashboard"
      ? "/dashboard"
      : "/reset-password";
  return session.finish(
    NextResponse.redirect(new URL(destination, env.APP_URL)),
  );
}
