import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { AppError, invariant } from "@/server/errors";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financeReauthSchema } from "../../access/schemas";
import { verifyFinanceReauthentication } from "../../access/reauth";
import { financePrivate } from "../../ledger/http";
import {
  statementReserveSchema,
  statementImportSchema,
  statementActionSchema,
  statementPreviewSchema,
} from "./schemas";
import {
  reserveStatement,
  uploadStatementChunk,
  statementUpload,
  statementGrid,
  previewStatement,
  importStatement,
  statementAction,
  statementBatch,
  statementBatches,
  statementBankOptions,
} from "./service";
async function chunkBody(request: Request) {
  invariant(
    request.headers.get("content-type")?.split(";")[0] === "application/json",
    "CONTENT_TYPE",
    "Use application/json.",
    400,
  );
  const reader = request.body?.getReader(),
    parts: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 3_000_000) {
        await reader.cancel();
        throw new AppError(
          "BODY_TOO_LARGE",
          "A statement transport request must be smaller than 3 MB.",
          413,
        );
      }
      parts.push(value);
    }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new AppError("MALFORMED_JSON", "Invalid JSON body.", 400);
  }
}
export async function statementRead(
  request: Request,
  kind: "BATCH" | "UPLOAD" | "GRID" | "BANK",
  id?: string,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:statements:read:" + actor.id);
    const q = Object.fromEntries(new URL(request.url).searchParams),
      data =
        kind === "BANK"
          ? await statementBankOptions(actor, q)
          : kind === "UPLOAD"
            ? await statementUpload(actor, id ?? "")
            : kind === "GRID"
              ? await statementGrid(actor, id ?? "", q)
              : id
                ? await statementBatch(actor, id, q)
                : await statementBatches(actor, q);
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function statementTransport(request: Request, id: string) {
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers);
    await financeStatus(actor);
    await rateLimit("finance:statements:transport:" + actor.id, 30);
    const data = await uploadStatementChunk(
      actor,
      id,
      await chunkBody(request),
    );
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function statementPreview(request: Request, id: string) {
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers);
    await financeStatus(actor);
    await rateLimit("finance:statements:read:" + actor.id);
    const body = statementPreviewSchema.parse(await jsonBody(request)),
      data = await previewStatement(
        actor,
        id,
        body,
        Object.fromEntries(new URL(request.url).searchParams),
      );
    return financePrivate(NextResponse.json({ data }));
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function statementMutation(
  request: Request,
  action: "RESERVE" | "IMPORT" | "CANCEL" | "VOID",
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
    const { reauth, ...input } = z
        .object({ reauth: financeReauthSchema })
        .passthrough()
        .parse(await jsonBody(request)),
      body = (
        action === "RESERVE"
          ? statementReserveSchema
          : action === "IMPORT"
            ? statementImportSchema
            : statementActionSchema
      ).parse(input),
      verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const requestKey = request.headers.get("Idempotency-Key"),
      data =
        action === "RESERVE"
          ? await reserveStatement(
              verified.actor,
              verified.proof,
              body,
              requestKey,
              requestId,
            )
          : action === "IMPORT"
            ? await importStatement(
                verified.actor,
                verified.proof,
                id ?? "",
                body,
                requestKey,
                requestId,
              )
            : await statementAction(
                verified.actor,
                verified.proof,
                action,
                id ?? "",
                body,
                requestKey,
                requestId,
              );
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          {
            status:
              (action === "RESERVE" || action === "IMPORT") && !data.reused
                ? 201
                : 200,
          },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
