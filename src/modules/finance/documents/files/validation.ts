import { z } from "zod";
import { invariant } from "@/server/errors";
import { fileMetadata } from "@/modules/attachments/validation";
import { reasonSchema } from "../../accounting/schemas";
export const FINANCE_FILE_MAX = 10 * 1024 * 1024;
export const sourceSchema = z
  .object({
    sourceType: z.enum([
      "INVOICE",
      "BILL",
      "CUSTOMER_DOCUMENT",
      "SUPPLIER_DOCUMENT",
      "JOURNAL_DRAFT",
    ]),
    sourceId: z.uuid(),
  })
  .strict();
export const reserveFileSchema = sourceSchema
  .extend({
    fileName: fileMetadata.shape.fileName,
    mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    byteSize: z.number().int().min(1).max(FINANCE_FILE_MAX),
    sha256: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
    reason: reasonSchema,
  })
  .strict();
export const fileIntentSchema = z
  .object({
    id: z.uuid(),
    intent: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function validateFinanceBytes(
  meta: {
    fileName: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
  },
  body: Uint8Array,
  digest: (b: Uint8Array) => string,
) {
  reserveFileSchema
    .pick({ fileName: true, mimeType: true, byteSize: true, sha256: true })
    .parse({
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      byteSize: meta.byteSize,
      sha256: meta.sha256,
    });
  invariant(
    body.byteLength === meta.byteSize && digest(body) === meta.sha256,
    "FINANCE_FILE_INTEGRITY",
    "File size or contents changed. Upload the reserved file.",
    409,
  );
  const start = (s: number[]) => s.every((v, i) => body[i] === v);
  const valid =
    meta.mimeType === "application/pdf"
      ? start([37, 80, 68, 70, 45])
      : meta.mimeType === "image/png"
        ? start([137, 80, 78, 71, 13, 10, 26, 10])
        : start([255, 216, 255]);
  invariant(
    valid,
    "FINANCE_FILE_TYPE",
    "The contents do not match the selected PDF, PNG or JPEG type.",
    422,
  );
}
