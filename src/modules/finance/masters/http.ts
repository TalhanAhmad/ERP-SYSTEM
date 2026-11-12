import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { invariant } from "@/server/errors";
import { financeAccessSnapshot } from "../access/service";
import { requireFinanceEnabled } from "../access/policy";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financeReauthSchema } from "../access/schemas";
import { financePrivate } from "../ledger/http";
import { masterSchemas, type MasterAction } from "./schemas";
import {
  masters,
  masterDetail,
  masterCommand,
  type MasterResource,
} from "./service";
export async function masterRead(
  request: Request,
  resource: MasterResource,
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:masters:read:" + actor.id);
    return financePrivate(
      NextResponse.json({
        data: id
          ? await masterDetail(actor, resource, id)
          : await masters(
              actor,
              resource,
              Object.fromEntries(new URL(request.url).searchParams),
            ),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function masterMutation(
  request: Request,
  action: MasterAction,
  id?: string,
) {
  let finish = (r: NextResponse) => r;
  const requestId = crypto.randomUUID();
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers, { allowSecurity: true });
    await rateLimit("finance:reauth:" + actor.id, 6);
    invariant(
      (await financeAccessSnapshot(actor)).canManage,
      "FINANCE_OWNER_REQUIRED",
      "Only the Finance Owner manages setup.",
      403,
    );
    const { reauth, ...body } = masterSchemas[action]
      .safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse(await jsonBody(request));
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await masterCommand(
      verified.actor,
      verified.proof,
      action,
      { ...body, ...(id ? { id: z.uuid().parse(id) } : {}) },
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          { status: action.endsWith("_CREATE") ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
