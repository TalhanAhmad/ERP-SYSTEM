import { authAction } from "@/server/identity-http";
export const runtime = "nodejs";
export function POST(request: Request) {
  return authAction("password-update", request);
}
