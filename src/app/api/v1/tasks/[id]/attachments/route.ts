import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, mutationOrigin, rateLimit } from "@/server/http";
import { invariant } from "@/server/errors";
import { uploadAttachment } from "@/modules/attachments/service";
import { MAX_FILE_BYTES, fileMetadata } from "@/modules/attachments/validation";
import { storageAvailable } from "@/modules/attachments/storage";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    mutationOrigin(request);
    const actor = await context(request.headers);
    await rateLimit(`upload:${actor.id}`, 10);
    invariant(
      storageAvailable(),
      "STORAGE_UNAVAILABLE",
      "File uploads are not configured in this environment.",
      503,
    );
    const key = request.headers.get("idempotency-key");
    invariant(
      key && key.length >= 8 && key.length <= 128,
      "IDEMPOTENCY_REQUIRED",
      "Provide an upload retry key.",
      400,
    );
    let fileName = "";
    try {
      fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "");
    } catch {}
    const mimeType = request.headers.get("content-type") ?? "";
    fileMetadata.parse({ fileName, mimeType });
    const length = Number(request.headers.get("content-length") ?? 0);
    invariant(
      length <= MAX_FILE_BYTES,
      "FILE_SIZE",
      "Choose a file up to 4 MB.",
      413,
    );
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_FILE_BYTES) {
          await reader.cancel();
          invariant(false, "FILE_SIZE", "Choose a file up to 4 MB.", 413);
        }
        chunks.push(value);
      }
    const result = await uploadAttachment(
      actor,
      (await params).id,
      key,
      fileName,
      mimeType,
      Buffer.concat(chunks),
    );
    return NextResponse.json(
      { data: result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error, crypto.randomUUID());
  }
}
