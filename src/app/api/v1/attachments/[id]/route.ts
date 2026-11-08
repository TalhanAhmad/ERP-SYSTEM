import { hrApiAccess } from "@/lib/hr-access";
import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, mutationOrigin, rateLimit } from "@/server/http";
import {
  downloadAttachment,
  removeDraftAttachment,
} from "@/modules/attachments/service";
import { downloadDisposition } from "@/modules/attachments/validation";
export const runtime = "nodejs";
export const maxDuration = 60;
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  try {
    const actor = await context(request.headers);
    hrApiAccess(actor.role, request.method, "attachments");
    await rateLimit(`download:${actor.id}`, 60);
    const { file, bytes } = await downloadAttachment(actor, (await params).id);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.byteSize),
        "Content-Disposition": downloadDisposition(file.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    return failure(error, crypto.randomUUID());
  }
}
export async function DELETE(request: Request, { params }: Params) {
  try {
    mutationOrigin(request);
    const actor = await context(request.headers);
    hrApiAccess(actor.role, request.method, "attachments");
    await rateLimit(`mutation:${actor.id}`);
    return NextResponse.json({
      data: await removeDraftAttachment(actor, (await params).id),
    });
  } catch (error) {
    return failure(error, crypto.randomUUID());
  }
}
