import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financeReauthSchema } from "../../access/schemas";
import { verifyFinanceReauthentication } from "../../access/reauth";
import { financePrivate } from "../../ledger/http";
import { cashFlowConfirmSchema } from "./schemas";
import { cashFlow, cashFlowReview, cashFlowConfirm } from "./service";
export async function cashFlowRead(
  request: Request,
  kind: "REPORT" | "REVIEW",
  journalId?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:cash-flow:" + actor.id);
    await financeStatus(actor);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (kind === "REVIEW")
      z.object({ page: z.string().optional() }).strict().parse(q);
    const data =
      kind === "REPORT"
        ? await cashFlow(actor, q)
        : await cashFlowReview(actor, { ...q, journalId });
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function cashFlowMutation(request: Request) {
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
    const business = cashFlowConfirmSchema.parse(body),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await cashFlowConfirm(
      verified.actor,
      verified.proof,
      business,
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return financePrivate(finish(NextResponse.json({ data }, { status: 200 })));
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
