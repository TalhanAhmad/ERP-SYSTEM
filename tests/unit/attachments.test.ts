import { it, expect, describe } from "vitest";
import {
  validateFile,
  MAX_FILE_BYTES,
  downloadDisposition,
} from "@/modules/attachments/validation";
import { submitTask } from "@/modules/tasks/schemas";
const bytes = (s: string) => new TextEncoder().encode(s);
describe("Attachment input validation", () => {
  it.each([
    ["application/pdf", [37, 80, 68, 70, 45, 49]],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255, 224]],
  ])("validates %s signatures", (mime, signature) =>
    expect(
      validateFile("example.file", mime, new Uint8Array(signature)),
    ).toHaveProperty("mimeType", mime),
  );
  it("accepts UTF-8 text and Unicode filenames", () =>
    expect(
      validateFile("ملف.txt", "text/plain", bytes("Work completed ✓")),
    ).toHaveProperty("fileName", "ملف.txt"));
  it.each(["text/html", "image/svg+xml", "application/octet-stream"])(
    "rejects unsupported %s",
    (mime) =>
      expect(() => validateFile("bad.file", mime, bytes("data"))).toThrow(),
  );
  it.each([
    "../secret.txt",
    "folder/file.pdf",
    "folder\\file.pdf",
    "bad\nname.txt",
    "bad\u0000.txt",
  ])("rejects unsafe file names", (name) =>
    expect(() => validateFile(name, "text/plain", bytes("text"))).toThrow(),
  );
  it("rejects empty, excessive, binary-text and invalid UTF-8 content", () => {
    for (const content of [
      new Uint8Array(),
      new Uint8Array(MAX_FILE_BYTES + 1),
      new Uint8Array([0]),
      new Uint8Array([255]),
    ])
      expect(() => validateFile("file.txt", "text/plain", content)).toThrow();
  });
  it("accepts the exact bounded size", () =>
    expect(
      validateFile(
        "file.txt",
        "text/plain",
        new Uint8Array(MAX_FILE_BYTES).fill(65),
      ),
    ).toHaveProperty("mimeType", "text/plain"));
  it("rejects MIME spoofing", () =>
    expect(() =>
      validateFile("image.png", "image/png", bytes("<html>fake image</html>")),
    ).toThrow());
  it("encodes the download filename without header injection", () => {
    const result = downloadDisposition("report's ✓.txt");
    expect(result).toContain("attachment;");
    expect(result).toContain("%27");
    expect(result).toContain("%E2%9C%93");
  });
  it("rejects duplicate and excessive submission attachment references", () => {
    const id = crypto.randomUUID(),
      base = { expectedVersion: 1, summary: "Work", artifactLinks: [] };
    expect(
      submitTask.safeParse({ ...base, attachmentIds: [id, id] }).success,
    ).toBe(false);
    expect(
      submitTask.safeParse({
        ...base,
        attachmentIds: Array.from({ length: 11 }, () => crypto.randomUUID()),
      }).success,
    ).toBe(false);
  });
});
