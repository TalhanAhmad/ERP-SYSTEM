import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { mutationOrigin, jsonBody, rateLimit, failure } from "@/server/http";
import { invariant } from "@/server/errors";
import {
  runAttendanceJob,
  runJobSchema,
  requireOperator,
} from "@/server/jobs/monitoring";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    mutationOrigin(request);
    const actor = await context(request.headers);
    requireOperator(actor);
    await rateLimit(`job-run:${actor.id}`, 10);
    const input = runJobSchema.parse(await jsonBody(request)),
      key = request.headers.get("idempotency-key");
    invariant(key, "IDEMPOTENCY_REQUIRED", "Provide a request retry key.", 400);
    return NextResponse.json(
      { data: await runAttendanceJob((await params).id, key, actor, input) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error, crypto.randomUUID());
  }
}
