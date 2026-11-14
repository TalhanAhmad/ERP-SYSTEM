import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  reserveFileSchema,
  validateFinanceBytes,
  FINANCE_FILE_MAX,
} from "@/modules/finance/documents/files/validation";
import { financeUploadCsp } from "@/lib/finance-upload-csp";
const bytes = new TextEncoder().encode("%PDF-1.7\nSynthetic evidence\n%%EOF"),
  digest = (data: Uint8Array) =>
    createHash("sha256").update(data).digest("hex"),
  meta = {
    fileName: "Evidence.pdf",
    mimeType: "application/pdf",
    byteSize: bytes.length,
    sha256: digest(bytes),
  };
it("allows only bounded PDF/PNG/JPEG evidence with immutable declared digest", () => {
  const b = {
    ...meta,
    sourceType: "BILL",
    sourceId: crypto.randomUUID(),
    reason: "Reviewed evidence",
  };
  expect(reserveFileSchema.safeParse(b).success).toBe(true);
  for (const patch of [
    { mimeType: "text/plain" },
    { mimeType: "image/svg+xml" },
    { byteSize: FINANCE_FILE_MAX + 1 },
    { byteSize: 0 },
    { byteSize: 2.1 },
    { fileName: "../secret.pdf" },
    { fileName: "receipt\n.pdf" },
    { sha256: "invalid" },
    { objectKey: "caller/path" },
  ])
    expect(reserveFileSchema.safeParse({ ...b, ...patch }).success).toBe(false);
});
it("verifies actual byte size, exact digest and type signature before quarantine completion", () => {
  expect(() => validateFinanceBytes(meta, bytes, digest)).not.toThrow();
  expect(() =>
    validateFinanceBytes({ ...meta, byteSize: 1 }, bytes, digest),
  ).toThrow();
  expect(() =>
    validateFinanceBytes({ ...meta, sha256: "0".repeat(64) }, bytes, digest),
  ).toThrow();
  const invalid = new TextEncoder().encode("<html>not PDF</html>");
  expect(() =>
    validateFinanceBytes(
      { ...meta, byteSize: invalid.length, sha256: digest(invalid) },
      invalid,
      digest,
    ),
  ).toThrow();
});
it("permits browser network access only to the configured finance upload path", () => {
  expect(financeUploadCsp(true, true, "https://storage.example.test")).toBe(
    " https://storage.example.test/storage/v1/object/upload/sign/encova-finance-evidence/",
  );
  expect(financeUploadCsp(false, true, "https://storage.example.test")).toBe(
    "",
  );
  expect(financeUploadCsp(true, false, "https://storage.example.test")).toBe(
    "",
  );
  for (const url of [
    "https://secret:password@storage.example.test",
    "https://storage.example.test/?token=secret",
    "http://untrusted.example.test",
    "javascript:alert(1)",
    "not a URL",
  ])
    expect(financeUploadCsp(true, true, url)).toBe("");
  expect(financeUploadCsp(true, true, "http://127.0.0.1:3101")).toContain(
    "http://127.0.0.1:3101/storage/",
  );
});
