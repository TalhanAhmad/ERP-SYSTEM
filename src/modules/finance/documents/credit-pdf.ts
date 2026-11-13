import "server-only";
import PDFDocument from "pdfkit";
import { join } from "node:path";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { withFinanceAccess } from "../access/policy";
import { customerDetail } from "../receivables/customer/service";
export function creditPdf(actor: Pick<Actor, "id">, id: string) {
  return withFinanceAccess(actor, async () => {
    const { item: i } = await customerDetail(actor, "CUSTOMER_CREDIT", id);
    invariant(
      i.storedState === "POSTED",
      "FINANCE_CREDIT_UNPOSTED",
      "Only posted credit notes can be downloaded.",
      409,
    );
    const party = i.partySnapshot as {
        name: string;
        legalName: string;
        address: string | null;
        contactEmail: string | null;
      },
      doc = new PDFDocument({
        size: "A4",
        margin: 48,
        info: { Title: i.number, Author: "Encova Workspace" },
      }),
      chunks: Buffer[] = [];
    const result = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (b: Buffer) => chunks.push(b));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    doc.font(join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf"));
    const text = (s: string, size = 10) =>
      doc.fontSize(size).text(s, { width: 495, lineGap: 3 }).moveDown(0.5);
    text("Encova Workspace · Credit note", 18);
    text(i.number, 16);
    text(party.legalName, 13);
    text(party.name);
    if (party.address) text(party.address);
    if (party.contactEmail) text(party.contactEmail);
    text("Original invoice: " + i.creditInvoice?.number);
    text(`Credit date: ${i.documentDate}    Posting date: ${i.postingDate}`);
    text("Reference: " + i.reference);
    text(i.description);
    for (const c of i.creditLines) {
      text(`${c.sequence}. ${c.invoiceLine.description}`, 11);
      text(`${c.invoiceLine.recognition}    Credit PKR ${c.amount}`);
    }
    text("Total credit: PKR " + i.totalAmount, 14);
    if (i.creditSplit)
      text(
        `Receivables reduced PKR ${i.creditSplit.arAmount}    Held customer credit PKR ${i.creditSplit.balanceAmount}`,
      );
    if (i.reversedBy)
      text(
        "REVERSED on " + i.reversedBy.postingDate + " · " + i.reversedBy.number,
        12,
      );
    text(
      "This credit note records no cash refund. Refunds and applications are separate dated transactions.",
    );
    doc.end();
    return result;
  });
}
