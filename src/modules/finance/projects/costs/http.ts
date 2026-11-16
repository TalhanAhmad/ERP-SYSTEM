import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financeReauthSchema } from "../../access/schemas";
import { verifyFinanceReauthentication } from "../../access/reauth";
import { financePrivate } from "../../ledger/http";
import { costSchemas, type CostAction } from "./schemas";
import {
  costAllocationCommand,
  costAllocationDetail,
  costAllocations,
  costSources,
  costSourceDetail,
  costProjectOptions,
  costPercentagePreview,
  projectFinancialResult,
} from "./service";
export async function costRead(
  request: Request,
  kind: "SOURCE" | "PROJECT" | "ALLOCATION" | "RESULT",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:cost:read:" + actor.id);
    const raw = Object.fromEntries(new URL(request.url).searchParams);
    const data =
      kind === "SOURCE"
        ? id
          ? await costSourceDetail(actor, id)
          : await costSources(actor, raw)
        : kind === "PROJECT"
          ? await costProjectOptions(actor, raw)
          : kind === "RESULT"
            ? await projectFinancialResult(actor, id ?? "", raw)
            : id
              ? await costAllocationDetail(actor, id)
              : await costAllocations(actor, raw);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function costPreview(request: Request) {
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers);
    await rateLimit("finance:cost:read:" + actor.id);
    const data = await costPercentagePreview(actor, await jsonBody(request));
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function costMutation(
  request: Request,
  action: CostAction,
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
    const business = costSchemas[action].parse(body),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await costAllocationCommand(
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
