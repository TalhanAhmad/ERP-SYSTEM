import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { invoiceSchemas, type InvoiceAction } from "./schemas";
import { invoiceCommand, invoiceDetail, invoices } from "./service";
export async function invoiceRead(request: Request, id?: string) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:invoices:read:" + actor.id);
    const data = id
      ? await invoiceDetail(actor, id)
      : await invoices(
          actor,
          Object.fromEntries(new URL(request.url).searchParams),
        );
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function invoiceMutation(
  request: Request,
  action: InvoiceAction,
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
    const { reauth, ...body } = invoiceSchemas[action]
      .safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse(await jsonBody(request));
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await invoiceCommand(
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
          { status: action === "CREATE" ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
