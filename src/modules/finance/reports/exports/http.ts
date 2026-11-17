import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financeReauthSchema } from "../../access/schemas";
import { verifyFinanceReauthentication } from "../../access/reauth";
import { financePrivate } from "../../ledger/http";
import { exportRequestSchema, exportChangeSchema } from "./schemas";
import {
  exportRegister,
  exportDetail,
  exportDownload,
  exportCommand,
} from "./service";
import { processExport } from "./worker";
export async function exportRead(
  request: Request,
  id?: string,
  format?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:exports:" + actor.id);
    await financeStatus(actor);
    const q = Object.fromEntries(new URL(request.url).searchParams);
    if (format) {
      z.object({}).strict().parse(q);
      const file = await exportDownload(actor, id, format);
      return new NextResponse(file.bytes, {
        headers: {
          "Content-Type":
            file.format === "pdf"
              ? "application/pdf"
              : "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="encova-${file.id}.${file.format}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    const data = id
      ? await exportDetail(actor, id, q)
      : await exportRegister(actor, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function exportMutation(
  request: Request,
  action: "REQUEST" | "RETRY" | "CANCEL",
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
    const business =
      action === "REQUEST"
        ? exportRequestSchema.parse(body)
        : exportChangeSchema.parse({ ...body, id: z.uuid().parse(id) });
    const v = await verifyFinanceReauthentication(request, reauth);
    finish = v.finish;
    const data = await exportCommand(
      v.actor,
      v.proof,
      action,
      business,
      request.headers.get("Idempotency-Key"),
      requestId,
    );
    if (action !== "CANCEL")
      try {
        await processExport(data.id);
      } catch {
        /* The durable queued job/lease remains resumable; report its current state below. */
      }
    const current = await exportDetail(v.actor, data.id);
    return financePrivate(
      finish(
        NextResponse.json(
          {
            data: {
              id: current.id,
              version: current.version,
              state: current.state,
            },
          },
          { status: action === "REQUEST" ? 202 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
