import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financeReauthSchema } from "../../access/schemas";
import { verifyFinanceReauthentication } from "../../access/reauth";
import { financePrivate } from "../../ledger/http";
import { bankMatchSchemas, type BankMatchAction } from "./schemas";
import {
  bankMatchCommand,
  bankMatchDetail,
  bankMatches,
  bankMatchOptions,
  bankMatchPreview,
} from "./service";
export async function matchRead(
  request: Request,
  kind: "OPTIONS" | "MATCH",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:bank-match:read:" + actor.id);
    const q = Object.fromEntries(new URL(request.url).searchParams),
      data =
        kind === "OPTIONS"
          ? await bankMatchOptions(actor, q)
          : id
            ? await bankMatchDetail(actor, id, q)
            : await bankMatches(actor, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function matchPreview(request: Request) {
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers);
    await rateLimit("finance:bank-match:read:" + actor.id);
    return financePrivate(
      NextResponse.json({
        data: await bankMatchPreview(actor, await jsonBody(request)),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function matchMutation(
  request: Request,
  action: BankMatchAction,
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
    const business = bankMatchSchemas[action].parse(body),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const data = await bankMatchCommand(
      verified.actor,
      verified.proof,
      action,
      { ...business, ...(id ? { id: z.uuid().parse(id) } : {}) },
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return financePrivate(
      finish(
        NextResponse.json({ data }, { status: action === "MATCH" ? 201 : 200 }),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
