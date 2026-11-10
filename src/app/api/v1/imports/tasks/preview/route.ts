import { NextResponse } from "next/server";
import { z } from "zod";
import { context } from "@/server/context";
import { mutationOrigin, rateLimit, failure } from "@/server/http";
import { invariant, AppError } from "@/server/errors";
import { mutate } from "@/server/transaction";
import { previewCsv } from "@/modules/imports/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    mutationOrigin(request);
    const actor = await context(request.headers);
    invariant(
      ["SUPER_ADMIN", "TEAM_LEAD"].includes(actor.role),
      "FORBIDDEN",
      "Project manager access required.",
      403,
    );
    await rateLimit("csv-preview:" + actor.id, 20);
    invariant(
      request.headers.get("content-type")?.split(";")[0].toLowerCase() ===
        "text/csv",
      "CONTENT_TYPE",
      "Upload a UTF-8 CSV file.",
      400,
    );
    const projectId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("projectId"));
    const reader = request.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2097152) {
          await reader.cancel();
          throw new AppError("BODY_TOO_LARGE", "CSV exceeds 2 MB.", 413);
        }
        chunks.push(value);
      }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch {
      throw new AppError("CSV_ENCODING", "Use a UTF-8 CSV file.");
    }
    const data = await mutate(
      actor,
      "imports/tasks/preview",
      request.headers.get("idempotency-key"),
      { projectId, text },
      (tx) => previewCsv(tx, actor, projectId, text),
    );
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error, requestId);
  }
}
