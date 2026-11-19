import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { financeStatus, requireFinanceEnabled } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { exportDetail } from "../reports/exports/service";
import { processExport } from "../reports/exports/worker";
import { closeSchemas, type CloseAction } from "./schemas";
import {
  closeCommand,
  closePreview,
  closeHistory,
  closeDetail,
  closeIssues,
  closeReport,
} from "./service";
export async function closingRead(
  request: Request,
  action: "PREVIEW" | "HISTORY" | "DETAIL" | "ISSUES" | "REPORT",
  periodId: string,
  id?: string,
  reportType?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:close:read:" + actor.id);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (action === "PREVIEW" || action === "DETAIL")
      z.object({}).strict().parse(q);
    const data =
      action === "PREVIEW"
        ? await closePreview(actor, periodId)
        : action === "HISTORY"
          ? await closeHistory(actor, periodId, q)
          : action === "ISSUES"
            ? await closeIssues(actor, periodId, q)
            : action === "DETAIL"
              ? await closeDetail(actor, periodId, id)
              : await closeReport(actor, periodId, id, reportType, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function closingMutation(
  request: Request,
  action: CloseAction,
  periodId: string,
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
        .parse(await jsonBody(request)),
      business = closeSchemas[action].parse(body),
      v = await verifyFinanceReauthentication(request, reauth);
    finish = v.finish;
    const data = await closeCommand(
      v.actor,
      v.proof,
      action,
      periodId,
      business,
      request.headers.get("Idempotency-Key"),
      id,
      requestId,
    );
    if (action === "EXPORT") {
      try {
        await processExport(data.id);
      } catch {
        /* Retained worker lease resumes privately. */
      }
      const current = await exportDetail(v.actor, data.id);
      return financePrivate(
        finish(
          NextResponse.json(
            {
              data: { ...data, version: current.version, state: current.state },
            },
            { status: 202 },
          ),
        ),
      );
    }
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          {
            status: action === "CLOSE" || action === "ISSUE_CREATE" ? 201 : 200,
          },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
