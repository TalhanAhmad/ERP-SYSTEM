import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { context } from "@/server/context";
import { invariant } from "@/server/errors";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled } from "../access/policy";
import { financeAccessSnapshot } from "../access/service";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financeReauthSchema } from "../access/schemas";
import {
  setupCommand,
  setupSchemas,
  accounts,
  accountDetail,
  periods,
  periodDetail,
  type SetupAction,
} from "./service";
function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
export async function setupRead(
  request: Request,
  resource: "accounts" | "periods",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit(`finance:setup:read:${actor.id}`);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const data = id
      ? resource === "accounts"
        ? await accountDetail(actor, id)
        : await periodDetail(actor, id)
      : resource === "accounts"
        ? await accounts(actor, query)
        : await periods(actor, query);
    return privateResponse(NextResponse.json({ data }));
  } catch (error) {
    return privateResponse(failure(error, crypto.randomUUID()));
  }
}
export async function setupMutation(
  request: Request,
  action: SetupAction,
  id?: string,
) {
  let finish = (response: NextResponse) => response;
  const requestId = crypto.randomUUID();
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers, { allowSecurity: true });
    await rateLimit(`finance:reauth:${actor.id}`, 6);
    const snapshot = await financeAccessSnapshot(actor);
    invariant(
      snapshot.canManage,
      "FINANCE_OWNER_REQUIRED",
      "Only the Finance Owner can change accounting setup.",
      403,
    );
    const parsed = setupSchemas[action]
      .safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse(await jsonBody(request));
    const { reauth, ...body } = parsed;
    const binding = id === undefined ? {} : { id: z.uuid().parse(id) };
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await setupCommand(
      verified.actor,
      verified.proof,
      action,
      { ...body, ...binding },
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return privateResponse(
      finish(
        NextResponse.json(
          { data },
          { status: action.endsWith("_CREATE") ? 201 : 200 },
        ),
      ),
    );
  } catch (error) {
    return privateResponse(finish(failure(error, requestId)));
  }
}
