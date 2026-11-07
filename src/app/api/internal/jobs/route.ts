import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/server/jobs/authorization";
import { scheduledPass } from "@/server/jobs/scheduled";
import { env } from "@/server/env";
import { failure } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Trusted machine-to-machine scheduler endpoint, independent of browser sessions.
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), env.CRON_SECRET))
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized scheduler request.",
        },
      },
      { status: 401 },
    );
  try {
    return NextResponse.json(
      { data: await scheduledPass() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error, crypto.randomUUID());
  }
}
