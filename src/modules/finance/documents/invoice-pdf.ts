import "server-only";
import PDFDocument from "pdfkit";
import { join } from "node:path";
import { withFinanceAccess } from "../access/policy";
import { invoiceDetail } from "../receivables/service";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
export function invoicePdf(actor: Pick<Actor, "id">, id: string) {
  return withFinanceAccess(actor, async () => {
    const { item: i } = await invoiceDetail(actor, id);
    invariant(
      i.state === "POSTED",
      "FINANCE_INVOICE_UNPOSTED",
      "Only posted invoices can be downloaded.",
      409,
    );
    const party = i.partySnapshot as {
      name: string;
      legalName: string;
      address: string | null;
      contactEmail: string | null;
    };
    const doc = new PDFDocument({
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
    const text = (s: string, size = 10) => {
      doc.fontSize(size).text(s, { width: 495, lineGap: 3 }).moveDown(0.5);
    };
    text("Encova Workspace · Invoice", 18);
    text(i.number, 16);
    text(party.legalName, 13);
    text(party.name);
    if (party.address) text(party.address);
    if (party.contactEmail) text(party.contactEmail);
    text(
      `Invoice: ${i.invoiceDate}    Posted: ${i.postingDate}    Due: ${i.dueDate}`,
    );
    if (i.reference) text("Reference: " + i.reference);
    text(i.description);
    for (const l of i.lines) {
      text(`${l.sequence}. ${l.description}`, 11);
      text(
        `${l.quantity} × PKR ${l.unitRate}    Discount PKR ${l.discountAmount}`,
      );
      text(`${l.recognition}    Total PKR ${l.totalAmount}`);
    }
    text(
      `Gross PKR ${i.lineAmount}    Discount PKR ${i.discountAmount}    Tax PKR ${i.taxAmount}`,
    );
    text("Total due: PKR " + i.totalAmount, 14);
    text(
      "Posted invoice · version " +
        i.version +
        " · No payment is recorded by this document.",
    );
    doc.end();
    return result;
  });
}
