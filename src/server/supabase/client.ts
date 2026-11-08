import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  createServerClient,
  parseCookieHeader,
  type CookieMethodsServer,
} from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/server/env";
function configured() {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new Error("Supabase configuration is missing.");
  return { url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY };
}
export function supabaseWithCookies(adapter: CookieMethodsServer) {
  const { url, key } = configured();
  return createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(env.APP_URL).protocol === "https:",
      path: "/",
    },
    cookies: adapter,
  });
}
export async function supabaseServer(requestHeaders?: Headers) {
  if (requestHeaders)
    return supabaseWithCookies({
      getAll: () =>
        parseCookieHeader(requestHeaders.get("cookie") ?? "").flatMap((c) =>
          typeof c.value === "string" ? [{ name: c.name, value: c.value }] : [],
        ),
      setAll: () => {},
    });
  const jar = await cookies();
  return supabaseWithCookies({
    getAll: () => jar.getAll(),
    setAll: () => {
      /* Request-time cookie refresh is handled in src/proxy.ts. */
    },
  });
}
export function supabaseAdmin(fetcher?: typeof fetch) {
  const { url } = configured();
  if (!env.SUPABASE_SECRET_KEY)
    throw new Error("Supabase server secret key is missing.");
  return createClient(url, env.SUPABASE_SECRET_KEY, {
    ...(fetcher ? { global: { fetch: fetcher } } : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
