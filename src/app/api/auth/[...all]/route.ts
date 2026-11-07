import { getLegacyAuth } from "@/server/auth";
import { env } from "@/server/env";
export function GET(request: Request) {
  return env.AUTH_PROVIDER === "better-auth"
    ? getLegacyAuth().handler(request)
    : Response.json(
        { error: { code: "NOT_FOUND", message: "Endpoint not found." } },
        { status: 404 },
      );
}
export const POST = GET;
