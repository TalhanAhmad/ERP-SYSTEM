import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, invariant } from "./errors";
import { db } from "./db";
import { env } from "./env";
export async function jsonBody(request: Request) {
  invariant(
    request.headers.get("content-type")?.split(";")[0] === "application/json",
    "CONTENT_TYPE",
    "Use application/json.",
    400,
  );
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 262144) {
        await reader.cancel();
        throw new AppError("BODY_TOO_LARGE", "JSON body exceeds 256 KB.", 413);
      }
      chunks.push(value);
    }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AppError("MALFORMED_JSON", "Invalid JSON body.", 400);
  }
}
export function mutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(env.APP_URL).origin;
  invariant(
    origin === expected,
    "INVALID_ORIGIN",
    "A matching Origin header is required.",
    403,
  );
  invariant(
    request.headers.get("x-encova-csrf") === "1",
    "CSRF_REQUIRED",
    "Missing CSRF request header.",
    403,
  );
}
export async function rateLimit(key: string, max = 60) {
  const bucket = Math.floor(Date.now() / 60000);
  const id = `${key}:${bucket}`;
  const result = await db.rateLimit.upsert({
    where: { id },
    create: { id, expiresAt: new Date((bucket + 2) * 60000) },
    update: { count: { increment: 1 } },
  });
  invariant(
    result.count <= max,
    "RATE_LIMITED",
    "Too many requests. Try again in a minute.",
    429,
  );
}
export function failure(error: unknown, requestId: string) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: { code: error.code, message: error.message, requestId } },
      { status: error.status },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION",
          message: "Check the highlighted fields.",
          fields: error.flatten(),
          requestId,
        },
      },
      { status: 422 },
    );
  console.error(
    JSON.stringify({
      requestId,
      type: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId,
      },
    },
    { status: 500 },
  );
}
