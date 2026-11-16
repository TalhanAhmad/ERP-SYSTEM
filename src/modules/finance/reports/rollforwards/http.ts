import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financePrivate } from "../../ledger/http";
import { rollforward, rollforwardHistory, postedSource } from "./service";
export async function rollforwardRead(
  request: Request,
  operation: "REPORT" | "HISTORY" | "SOURCE",
  kindOrId: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:rollforward:" + actor.id);
    await financeStatus(actor);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (operation === "SOURCE")
      z.object({ page: z.string().optional() }).strict().parse(q);
    const data =
      operation === "SOURCE"
        ? await postedSource(actor, { ...q, id: kindOrId })
        : operation === "REPORT"
          ? await rollforward(actor, kindOrId, q)
          : await rollforwardHistory(actor, kindOrId, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
