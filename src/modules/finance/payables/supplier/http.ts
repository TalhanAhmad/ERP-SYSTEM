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
  supplierSchemas,
  type SupplierAction,
  type SupplierResource,
} from "./schemas";
import { supplierCommand, supplierDetail, suppliers } from "./service";
export async function supplierRead(
  request: Request,
  resource: SupplierResource,
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:bills:read:" + actor.id);
    const data = id
      ? await supplierDetail(actor, resource, id)
      : await suppliers(
          actor,
          resource,
          Object.fromEntries(new URL(request.url).searchParams),
        );
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function supplierMutation(
  request: Request,
  resource: SupplierResource,
  action: SupplierAction,
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
    const { reauth, ...body } = supplierSchemas(resource)
      [action].safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse(await jsonBody(request));
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await supplierCommand(
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
