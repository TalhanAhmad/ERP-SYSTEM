import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, rateLimit } from "@/server/http";
import { requireFinanceEnabled } from "@/modules/finance/access/policy";
import { financePrivate } from "@/modules/finance/ledger/http";
import { creditPdf } from "@/modules/finance/documents/credit-pdf";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireFinanceEnabled();
    const actor = await context(r.headers);
    await rateLimit("finance:pdf:" + actor.id, 10);
    const { id } = await params,
      bytes = await creditPdf(actor, id);
    return financePrivate(
      new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            'attachment; filename="credit-note-' + id + '.pdf"',
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
