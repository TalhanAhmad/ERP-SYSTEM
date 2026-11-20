import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { financeStatus, requireFinanceEnabled } from "../access/policy";
import { financeReauthSchema } from "../access/schemas";
import { verifyFinanceReauthentication } from "../access/reauth";
import { financePrivate } from "../ledger/http";
import { openingSchemas, type OpeningAction } from "./schemas";
import {
  openingBatches,
  openingDetail,
  openingPreview,
  openingLines,
  openingSource,
  openingCommand,
} from "./service";
export async function openingRead(
  request: Request,
  action: "LIST" | "DETAIL" | "PREVIEW" | "LINES" | "SOURCE",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const a = await context(request.headers);
    await rateLimit("finance:opening:read:" + a.id);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (["DETAIL", "PREVIEW", "SOURCE"].includes(action))
      z.object({}).strict().parse(q);
    if (action === "SOURCE") {
      const source = await openingSource(a, id);
      return financePrivate(
        new NextResponse(source.sourceText, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${source.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
            "x-content-sha256": source.sourceHash,
          },
        }),
      );
    }
    const data =
      action === "LIST"
        ? await openingBatches(a, q)
        : action === "DETAIL"
          ? await openingDetail(a, id)
          : action === "PREVIEW"
            ? await openingPreview(a, id)
            : await openingLines(a, id, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function openingMutation(
  request: Request,
  action: OpeningAction,
  id?: string,
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
      business = openingSchemas[action].parse(body),
      v = await verifyFinanceReauthentication(request, reauth);
    finish = v.finish;
    const data = await openingCommand(
      v.actor,
      v.proof,
      action,
      id,
      business,
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
