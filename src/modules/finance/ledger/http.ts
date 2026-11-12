import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financeReauthSchema } from "../access/schemas";
import { ledgerSchemas, type LedgerAction } from "./schemas";
import { ledgerCommand, journalDetail, journals } from "./service";
export function financePrivate(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
export async function ledgerRead(request: Request, id?: string) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:ledger:read:" + actor.id);
    return financePrivate(
      NextResponse.json({
        data: id
          ? await journalDetail(actor, id)
          : await journals(
              actor,
              Object.fromEntries(new URL(request.url).searchParams),
            ),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function ledgerMutation(
  request: Request,
  action: LedgerAction,
  id?: string,
) {
  let finish = (r: NextResponse) => r;
  const requestId = crypto.randomUUID();
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers, { allowSecurity: true });
    await rateLimit("finance:reauth:" + actor.id, 6);
    await financeStatus(actor);
    const { reauth, ...body } = ledgerSchemas[action]
      .safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse(await jsonBody(request));
    const binding = id ? { id: z.uuid().parse(id) } : {};
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await ledgerCommand(
      verified.actor,
      verified.proof,
      action,
      { ...body, ...binding },
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          { status: action === "CREATE" ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
