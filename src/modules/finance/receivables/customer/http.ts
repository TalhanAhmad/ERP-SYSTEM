import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financeReauthSchema } from "../../access/schemas";
import { verifyFinanceReauthentication } from "../../access/reauth";
import { financePrivate } from "../../ledger/http";
import {
  customerSchemas,
  type CustomerAction,
  type CustomerResource,
} from "./schemas";
import { customerCommand, customerDetail, customers } from "./service";
export async function customerRead(
  request: Request,
  resource: CustomerResource,
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:invoices:read:" + actor.id);
    const data = id
      ? await customerDetail(actor, resource, id)
      : await customers(
          actor,
          resource,
          Object.fromEntries(new URL(request.url).searchParams),
        );
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function customerMutation(
  request: Request,
  resource: CustomerResource,
  action: CustomerAction,
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
    const { reauth, ...body } = customerSchemas(resource)
      [action].safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse(await jsonBody(request));
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await customerCommand(
      verified.actor,
      verified.proof,
      resource,
      action,
      { ...body, ...(id ? { id: z.uuid().parse(id) } : {}) },
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
