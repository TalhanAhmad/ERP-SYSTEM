import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { planningSchemas, type PlanningAction } from "./schemas";
import {
  planningCommand,
  budgetDetail,
  budgets,
  budgetVariance,
  forecastDetail,
  forecasts,
  planningOptions,
} from "./service";
export async function planningRead(
  request: Request,
  kind: "BUDGET" | "FORECAST" | "VARIANCE" | "OPTIONS",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:planning:read:" + actor.id);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    const data =
      kind === "BUDGET"
        ? id
          ? await budgetDetail(actor, id)
          : await budgets(actor, q)
        : kind === "FORECAST"
          ? id
            ? await forecastDetail(actor, id)
            : await forecasts(actor, q)
          : kind === "VARIANCE"
            ? await budgetVariance(actor, q)
            : await planningOptions(actor, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function planningMutation(
  request: Request,
  action: PlanningAction,
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
    const business = planningSchemas[action].parse(body),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await planningCommand(
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
          { status: action.endsWith("_CREATE") ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
