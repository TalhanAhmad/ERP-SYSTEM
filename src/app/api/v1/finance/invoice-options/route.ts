import { context } from "@/server/context";
import { failure, rateLimit } from "@/server/http";
import { NextResponse } from "next/server";
import { requireFinanceEnabled } from "@/modules/finance/access/policy";
import { financePrivate } from "@/modules/finance/ledger/http";
import { invoiceOptions } from "@/modules/finance/receivables/options";
export async function GET(request: Request) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:options:" + actor.id);
    return financePrivate(
      NextResponse.json({
        data: await invoiceOptions(
          actor,
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
