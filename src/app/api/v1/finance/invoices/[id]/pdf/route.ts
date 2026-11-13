import { NextResponse } from "next/server";
import { context } from "@/server/context";
import { failure, rateLimit } from "@/server/http";
import { requireFinanceEnabled } from "@/modules/finance/access/policy";
import { financePrivate } from "@/modules/finance/ledger/http";
import { invoicePdf } from "@/modules/finance/documents/invoice-pdf";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    requireFinanceEnabled();
    const actor = await context(r.headers);
    await rateLimit("finance:pdf:" + actor.id, 10);
    const { id } = await params,
      bytes = await invoicePdf(actor, id);
    return financePrivate(
      new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            'attachment; filename="invoice-' + id + '.pdf"',
          "X-Content-Type-Options": "nosniff",
        },
      }),
    );
  } catch (e) {
    return financePrivate(failure(e, crypto.randomUUID()));
  }
}
