import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { holdingSchemas, type HoldingAction } from "./schemas";
import {
  holdingCommand,
  holdingDetail,
  holdings,
  investmentLots,
} from "./service";
export async function holdingRead(request: Request, id?: string, lots = false) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:movements:read:" + actor.id);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return financePrivate(
      NextResponse.json({
        data:
          lots && id
            ? await investmentLots(actor, id, query)
            : id
              ? await holdingDetail(actor, id)
              : await holdings(actor, query),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function holdingMutation(
  request: Request,
  action: HoldingAction,
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
    const { reauth, ...body } = z
      .object({ reauth: financeReauthSchema })
      .passthrough()
      .parse(await jsonBody(request));
    const business = holdingSchemas[action].parse(body),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await holdingCommand(
      verified.actor,
      verified.proof,
      action,
      { ...business, ...(id ? { id: z.uuid().parse(id) } : {}) },
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
