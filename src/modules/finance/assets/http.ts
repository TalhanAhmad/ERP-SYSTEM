import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { assetSchemas, type AssetAction } from "./schemas";
import { assetCommand, assetDetail, assets, assetOptions } from "./service";
export async function assetRead(
  request: Request,
  id?: string,
  options = false,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:assets:read:" + actor.id);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return financePrivate(
      NextResponse.json({
        data: options
          ? await assetOptions(actor, query)
          : id
            ? await assetDetail(actor, id)
            : await assets(actor, query),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function assetMutation(
  request: Request,
  action: AssetAction,
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
    const business = assetSchemas[action].parse(body),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await assetCommand(
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
