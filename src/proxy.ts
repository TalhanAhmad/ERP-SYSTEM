import { financeUploadCsp } from "@/lib/finance-upload-csp";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
export async function proxy(request: NextRequest) {
  const financePath =
    request.nextUrl.pathname === "/finance" ||
    request.nextUrl.pathname.startsWith("/finance/") ||
    request.nextUrl.pathname === "/api/v1/finance" ||
    request.nextUrl.pathname.startsWith("/api/v1/finance/");
  const protectFinanceCache = (response: NextResponse) => {
    if (financePath)
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  };
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${financeUploadCsp(process.env.FINANCE_ENABLED === "true", financePath, process.env.SUPABASE_URL)}${process.env.NODE_ENV === "development" ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const next = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const result = NextResponse.next({ request: { headers: requestHeaders } });
    result.headers.set("Content-Security-Policy", csp);
    return protectFinanceCache(result);
  };
  if (process.env.AUTH_PROVIDER !== "supabase") return next();
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    return protectFinanceCache(
      NextResponse.json(
        {
          error: {
            code: "CONFIGURATION",
            message: "Authentication is not configured.",
          },
        },
        { status: 503 },
      ),
    );
  let response = next();
  const supabase = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.APP_URL ?? request.nextUrl.origin).startsWith(
        "https://",
      ),
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values, cacheHeaders) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(cacheHeaders).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });
  await supabase.auth.getUser();
  // Authorization remains in context/services. Never cache cookie-bearing auth responses.
  return protectFinanceCache(response);
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/internal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
