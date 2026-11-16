import "server-only";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../access/policy";
import { financePrivate } from "../ledger/http";
import { generalLedger, trialBalance, reportAccountOptions } from "./service";
export async function coreReportRead(
  request: Request,
  kind: "GENERAL_LEDGER" | "TRIAL_BALANCE" | "ACCOUNT_OPTIONS",
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:core-report:" + actor.id);
    await financeStatus(actor);
    const q = Object.fromEntries(new URL(request.url).searchParams),
      data =
        kind === "GENERAL_LEDGER"
          ? await generalLedger(actor, q)
          : kind === "TRIAL_BALANCE"
            ? await trialBalance(actor, q)
            : await reportAccountOptions(actor, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
