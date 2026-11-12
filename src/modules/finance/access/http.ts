import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { context } from "@/server/context";
import { invariant } from "@/server/errors";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { financeReauthSchema, type AccessAction } from "./schemas";
import { requireFinanceEnabled } from "./policy";
import { accessCommand, financeAccessSnapshot } from "./service";
import { verifyFinanceReauthentication } from "./reauth";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
export async function accessRead(request: Request) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit(`finance:access:${actor.id}`);
    return privateResponse(
      NextResponse.json({ data: await financeAccessSnapshot(actor) }),
    );
  } catch (error) {
    return privateResponse(failure(error, crypto.randomUUID()));
  }
}
export async function accessMutation(
  request: Request,
  action: AccessAction,
  schema: z.ZodObject,
  binding: Record<string, string> = {},
) {
  const requestId = crypto.randomUUID();
  let finish = (response: NextResponse) => response;
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers, { allowSecurity: true });
    await rateLimit(`finance:reauth:${actor.id}`, 6);
    const snapshot = await financeAccessSnapshot(actor);
    invariant(
      action === "ACCEPT" || snapshot.canManage,
      "FINANCE_OWNER_REQUIRED",
      "Only the current Finance Owner can change access.",
      403,
    );
    const parsed = schema
      .extend({ reauth: financeReauthSchema })
      .strict()
      .parse(await jsonBody(request));
    const { reauth, ...input } = parsed;
    const ids = Object.fromEntries(
      Object.entries(binding).map(([name, value]) => [
        name,
        z.uuid().parse(value),
      ]),
    );
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await accessCommand(
      verified.actor,
      verified.proof,
      action,
      { ...input, ...ids } as Prisma.InputJsonObject,
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return privateResponse(
      finish(
        NextResponse.json(
          { data },
          { status: action === "GRANT" || action === "TRANSFER" ? 201 : 200 },
        ),
      ),
    );
  } catch (error) {
    return privateResponse(finish(failure(error, requestId)));
  }
}
