import { z } from "zod";
import { invariant } from "@/server/errors";
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const fileMetadata = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(
      (v) => !/[\x00-\x1f\x7f/\\]/.test(v),
      "Use a simple file name without paths or control characters.",
    ),
  mimeType: z.enum([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/plain",
  ]),
});
export function validateFile(
  fileName: string,
  mimeType: string,
  body: Uint8Array,
) {
  const meta = fileMetadata.parse({ fileName, mimeType });
  invariant(
    body.byteLength > 0 && body.byteLength <= MAX_FILE_BYTES,
    "FILE_SIZE",
    "Choose a non-empty file up to 4 MB.",
    413,
  );
  const starts = (signature: number[]) =>
    signature.every((value, index) => body[index] === value);
  let valid = false;
  if (meta.mimeType === "application/pdf")
    valid = starts([0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (meta.mimeType === "image/png")
    valid = starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (meta.mimeType === "image/jpeg") valid = starts([255, 216, 255]);
  if (meta.mimeType === "text/plain")
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(body);
      valid = !body.includes(0);
    } catch {}
  invariant(
    valid,
    "FILE_TYPE",
    "File contents do not match the selected PDF, PNG, JPEG or UTF-8 text type.",
  );
  return meta;
}
export function downloadDisposition(name: string) {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}
