import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { financeStatus, requireFinanceEnabled } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { yearSchemas, type YearAction } from "./schemas";
import {
  fiscalYears,
  yearPreview,
  yearHistory,
  yearDetail,
  yearReport,
  yearCommand,
} from "./service";
export async function yearRead(
  request: Request,
  action: "LIST" | "PREVIEW" | "HISTORY" | "DETAIL" | "REPORT",
  yearId?: string,
  closeId?: string,
  reportType?: string,
  stage?: string,
) {
  try {
    requireFinanceEnabled();
    const a = await context(request.headers);
    await rateLimit("finance:year:read:" + a.id);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (action === "PREVIEW" || action === "DETAIL")
      z.object({}).strict().parse(q);
    const data =
      action === "LIST"
        ? await fiscalYears(a, q)
        : action === "PREVIEW"
          ? await yearPreview(a, yearId)
          : action === "HISTORY"
            ? await yearHistory(a, yearId, q)
            : action === "DETAIL"
              ? await yearDetail(a, yearId, closeId)
              : await yearReport(a, yearId, closeId, reportType, stage, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function yearMutation(
  request: Request,
  action: YearAction,
  yearId?: string,
) {
  let finish = (r: NextResponse) => r;
  const requestId = crypto.randomUUID();
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const a = await context(request.headers, { allowSecurity: true });
    await rateLimit("finance:reauth:" + a.id, 6);
    await financeStatus(a);
    const { reauth, ...body } = z
        .object({ reauth: financeReauthSchema })
        .passthrough()
        .parse(await jsonBody(request)),
      business = yearSchemas[action].parse(body),
      v = await verifyFinanceReauthentication(request, reauth);
    finish = v.finish;
    const data = await yearCommand(
      v.actor,
      v.proof,
      action,
      yearId,
      business,
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          { status: action === "CREATE" || action === "CLOSE" ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
