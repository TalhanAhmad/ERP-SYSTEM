import "server-only";
import PDFDocument from "pdfkit";
import { join } from "node:path";
import type { ExportSnapshot } from "./types";
import {
  cellText,
  columnLabel,
  exportColumns,
  exportSections,
  MAX_EXPORT_BYTES,
} from "./format";
import { reportLabels } from "./schemas";
export async function renderExportPdf(
  snapshot: ExportSnapshot,
  hash: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const generated = new Date(snapshot.report.metadata.generatedAt),
      doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 30,
        autoFirstPage: false,
        info: {
          Title: reportLabels[snapshot.reportType],
          Author: snapshot.report.metadata.company,
          CreationDate: generated,
          ModDate: generated,
        },
      }),
      chunks: Buffer[] = [];
    let size = 0,
      failed = false,
      page = 0,
      y = 0;
    const fail = (error: Error) => {
      if (!failed) {
        failed = true;
        doc.destroy();
        reject(error);
      }
    };
    doc.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_EXPORT_BYTES) fail(new Error("FINANCE_EXPORT_LIMIT"));
      else chunks.push(chunk);
    });
    doc.on("error", fail);
    doc.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    try {
      doc.font(join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf"));
      const left = 30,
        width = 781,
        lineHeight = 11,
        bottom = 548;
      const newPage = (section: string) => {
        if (++page > 1000) throw new Error("FINANCE_EXPORT_LIMIT");
        doc.addPage();
        doc
          .fontSize(11)
          .text(
            `${snapshot.report.metadata.company} — ${reportLabels[snapshot.reportType]}`,
            left,
            25,
            { width },
          );
        doc
          .fontSize(8)
          .text(
            `${snapshot.mode} · ${snapshot.readiness.finalEligible ? "Checks passed at capture" : "INCOMPLETE / REVIEW"} · PKR · ${snapshot.report.metadata.from} to ${snapshot.report.metadata.to}`,
            left,
            43,
            { width },
          );
        doc.text(section, left, 57, { width });
        doc
          .fontSize(7)
          .text(
            `Frozen ${snapshot.report.metadata.generatedAt} · SHA-256 ${hash} · Page ${page}`,
            left,
            565,
            { width, lineBreak: false },
          );
        y = 78;
      };
      const wrap = (text: string, w: number) => {
        const lines: string[] = [];
        for (const paragraph of text
          .replaceAll("\0", "\uFFFD")
          .split(/\r\n|\n|\r/)) {
          let current = "";
          for (const char of paragraph) {
            if (current && doc.widthOfString(current + char) > w - 8) {
              lines.push(current);
              current = char;
            } else current += char;
          }
          lines.push(current);
        }
        return lines;
      };
      const table = (title: string, headers: string[], rows: unknown[][]) => {
        const colWidth = width / headers.length;
        const header = () => {
          doc.fontSize(8);
          const lines = headers.map((h) => wrap(h, colWidth)),
            n = Math.max(...lines.map((l) => l.length));
          lines.forEach((ls, c) =>
            ls.forEach((s, i) =>
              doc.text(s, left + c * colWidth + 4, y + i * lineHeight, {
                width: colWidth - 8,
                lineBreak: false,
              }),
            ),
          );
          y += (n + 1) * lineHeight;
          doc
            .moveTo(left, y - 5)
            .lineTo(left + width, y - 5)
            .stroke();
        };
        newPage(title);
        header();
        for (const row of rows) {
          doc.fontSize(8);
          const cells = row.map((v) => wrap(cellText(v), colWidth));
          let offset = 0;
          const count = Math.max(1, ...cells.map((c) => c.length));
          while (offset < count) {
            if (y + lineHeight > bottom) {
              newPage(title + " (continued)");
              header();
            }
            const available = Math.max(
                1,
                Math.floor((bottom - y) / lineHeight),
              ),
              take = Math.min(available, count - offset);
            cells.forEach((ls, c) =>
              ls.slice(offset, offset + take).forEach((s, i) =>
                doc.text(s, left + c * colWidth + 4, y + i * lineHeight, {
                  width: colWidth - 8,
                  lineBreak: false,
                }),
              ),
            );
            y += take * lineHeight;
            offset += take;
          }
          y += 6;
        }
      };
      for (const section of exportSections(snapshot, hash))
        table(section.title, ["Field", "Value"], section.rows);
      const keys = exportColumns(snapshot.report.items);
      if (!keys.length)
        table(
          "All filtered report rows",
          ["Result"],
          [["No rows match these filters."]],
        );
      // Split wide reports into bands with stable row numbers; preserve every original column and value.
      for (let start = 0; start < keys.length; start += 5) {
        const band = keys.slice(start, start + 5);
        table(
          `All ${snapshot.rowCount} filtered rows · columns ${start + 1}–${start + band.length} of ${keys.length}`,
          ["Row", ...band.map(columnLabel)],
          snapshot.report.items.map((r, i) => [
            i + 1,
            ...band.map((k) => r[k]),
          ]),
        );
      }
      doc.end();
    } catch (error) {
      fail(error instanceof Error ? error : new Error("FINANCE_EXPORT_RENDER"));
    }
  });
}
