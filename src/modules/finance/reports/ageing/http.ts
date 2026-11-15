import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financePrivate } from "../../ledger/http";
import { ageing, ageingHistory, type AgeingSide } from "./service";
export async function ageingRead(
  request: Request,
  side: AgeingSide,
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:ageing:" + actor.id);
    await financeStatus(actor);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (id)
      z.object({ asOf: z.string(), page: z.string().optional() })
        .strict()
        .parse(q);
    const data = id
      ? await ageingHistory(actor, side, { ...q, documentId: id })
      : await ageing(actor, side, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
