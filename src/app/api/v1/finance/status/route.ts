import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, rateLimit } from "@/server/http";
import {
  financeStatus,
  requireFinanceEnabled,
} from "@/modules/finance/access/policy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = randomUUID();
  let response: NextResponse;
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit(`finance:status:${actor.id}`);
    response = NextResponse.json({ data: await financeStatus(actor) });
  } catch (error) {
    response = failure(error, requestId);
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
