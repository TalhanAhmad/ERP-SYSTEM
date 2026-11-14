import "server-only";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { taxSchemas } from "./schemas";
import { taxCodes, taxCommand } from "./service";
export async function taxRead(request: Request) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:tax:read:" + actor.id);
    return financePrivate(
      NextResponse.json({
        data: await taxCodes(
          actor,
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function taxMutation(
  request: Request,
  action: keyof typeof taxSchemas,
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
    const { reauth, ...body } = taxSchemas[action]
      .safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse({ ...(await jsonBody(request)), ...(id ? { id } : {}) });
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    return financePrivate(
      finish(
        NextResponse.json(
          {
            data: await taxCommand(
              verified.actor,
              verified.proof,
              action,
              body,
              request.headers.get("Idempotency-Key"),
              requestId,
            ),
          },
          { status: action === "CREATE" ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
