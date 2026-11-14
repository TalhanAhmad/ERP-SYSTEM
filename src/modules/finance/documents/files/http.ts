import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, jsonBody, mutationOrigin, rateLimit } from "@/server/http";
import { requireFinanceEnabled, financeStatus } from "../../access/policy";
import { financeReauthSchema } from "../../access/schemas";
import { verifyFinanceReauthentication } from "../../access/reauth";
import { financePrivate } from "../../ledger/http";
import { downloadDisposition } from "@/modules/attachments/validation";
import { reserveFileSchema } from "./validation";
import {
  files,
  fileDetail,
  reserveFile,
  completeFile,
  scanFile,
  retryFileScan,
  removeFile,
  downloadFile,
} from "./service";
export async function fileRead(
  request: Request,
  id?: string,
  download = false,
) {
  try {
    requireFinanceEnabled();
    const actor = await context(request.headers);
    await rateLimit("finance:files:read:" + actor.id);
    if (download && id) {
      const d = await downloadFile(actor, id, request.headers.get("Range"));
      return financePrivate(
        new NextResponse(Buffer.from(d.bytes), {
          status: d.partial ? 206 : 200,
          headers: {
            "Content-Type": d.file.mimeType,
            "Content-Disposition": downloadDisposition(d.file.fileName),
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
            "X-Content-SHA256": d.file.sha256,
            ...(d.partial
              ? {
                  "Content-Range": `bytes ${d.start}-${d.end}/${d.file.byteSize}`,
                }
              : {}),
          },
        }),
      );
    }
    return financePrivate(
      NextResponse.json({
        data: id
          ? await fileDetail(actor, id)
          : await files(
              actor,
              Object.fromEntries(new URL(request.url).searchParams),
            ),
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
export async function fileMutation(
  request: Request,
  action: "RESERVE" | "COMPLETE" | "SCAN" | "REMOVE",
  id?: string,
) {
  let finish = (r: NextResponse) => r;
  const requestId = crypto.randomUUID();
  try {
    requireFinanceEnabled();
    mutationOrigin(request);
    const actor = await context(request.headers, { allowSecurity: true });
    await financeStatus(actor);
    const raw = await jsonBody(request);
    const delegated = z
      .object({
        intent: z
          .string()
          .length(64)
          .regex(/^[a-f0-9]{64}$/),
      })
      .strict();
    if (
      action === "COMPLETE" ||
      (action === "SCAN" &&
        typeof raw === "object" &&
        raw !== null &&
        "intent" in raw)
    ) {
      await rateLimit("finance:files:complete:" + actor.id, 20);
      const body = delegated.parse(raw),
        input = { ...body, id: z.uuid().parse(id) };
      return financePrivate(
        NextResponse.json({
          data:
            action === "COMPLETE"
              ? await completeFile(actor, input)
              : await scanFile(actor, input),
        }),
      );
    }
    await rateLimit("finance:reauth:" + actor.id, 6);
    const schema =
      action === "RESERVE"
        ? reserveFileSchema
        : z.object({ reason: z.string().trim().min(3).max(500) }).strict();
    const { reauth, ...body } = schema
      .safeExtend({ reauth: financeReauthSchema })
      .strict()
      .parse(raw);
    const verified = await verifyFinanceReauthentication(request, reauth);
    finish = verified.finish;
    const key = request.headers.get("Idempotency-Key"),
      input = { ...body, ...(id ? { id: z.uuid().parse(id) } : {}) };
    const data =
      action === "RESERVE"
        ? await reserveFile(verified.actor, verified.proof, input, key)
        : action === "REMOVE"
          ? await removeFile(verified.actor, verified.proof, input, key)
          : await retryFileScan(verified.actor, verified.proof, input, key);
    return financePrivate(
      finish(
        NextResponse.json(
          { data },
          { status: action === "RESERVE" ? 201 : 200 },
        ),
      ),
    );
  } catch (e) {
    return financePrivate(finish(failure(e, requestId)));
  }
}
