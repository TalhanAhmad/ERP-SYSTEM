import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
export async function proxy(request: NextRequest) {
  if (process.env.AUTH_PROVIDER !== "supabase") return NextResponse.next();
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      {
        error: {
          code: "CONFIGURATION",
          message: "Authentication is not configured.",
        },
      },
      { status: 503 },
    );
  let response = NextResponse.next({ request });
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
        response = NextResponse.next({ request });
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
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/internal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
