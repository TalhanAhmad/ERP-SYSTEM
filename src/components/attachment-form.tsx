"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_FILE_BYTES } from "@/modules/attachments/validation";
type Draft = { id: string; fileName: string; byteSize: number; status: string };
export function AttachmentForm({
  taskId,
  enabled,
  drafts,
}: {
  taskId: string;
  enabled: boolean;
  drafts: Draft[];
}) {
  const router = useRouter(),
    retry = useRef<{ file: File; key: string } | null>(null);
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>Upload files</h2>
      <p className="note">
        PDF, PNG, JPEG or UTF-8 text. Up to 4 MB per file and 10 draft files.
        Choose uploaded files in your submission below.
      </p>
      {!enabled ? (
        <p className="muted">
          File uploads are not configured in this environment.
        </p>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            setError("");
            setMessage("");
            setPending(true);
            try {
              const file =
                form.querySelector<HTMLInputElement>('input[name="file"]')
                  ?.files?.[0];
              if (
                !(file instanceof File) ||
                !file.size ||
                file.size > MAX_FILE_BYTES
              )
                throw new Error("Choose a non-empty file up to 4 MB.");
              if (retry.current?.file !== file) {
                // File objects returned from the same input are stable across a network retry.
                retry.current = { file, key: crypto.randomUUID() };
              }
              const response = await fetch(
                `/api/v1/tasks/${taskId}/attachments`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": file.type,
                    "X-File-Name": encodeURIComponent(file.name),
                    "X-Encova-CSRF": "1",
                    "Idempotency-Key": retry.current.key,
                  },
                  body: file,
                },
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.error?.message ?? "Upload failed. Retry shortly.",
                );
              retry.current = null;
              form.reset();
              setMessage("File uploaded. Select it when submitting your work.");
              router.refresh();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Upload failed. Retry shortly.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            Choose a file
            <input
              name="file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,text/plain"
              required
              disabled={pending}
            />
          </label>
          <div className="form-actions">
            <button disabled={pending}>
              {pending ? "Uploading…" : "Upload file"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {drafts.length > 0 && (
        <ul className="file-list">
          {drafts.map((file) => (
            <li key={file.id}>
              <span>
                {file.fileName} · {Math.ceil(file.byteSize / 1024)} KB ·{" "}
                {file.status.toLowerCase()}
              </span>
              <button
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  setError("");
                  try {
                    const r = await fetch(`/api/v1/attachments/${file.id}`, {
                      method: "DELETE",
                      headers: { "X-Encova-CSRF": "1" },
                    });
                    const result = await r.json();
                    if (!r.ok)
                      throw new Error(
                        result.error?.message ?? "Unable to remove file.",
                      );
                    router.refresh();
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Unable to remove file.",
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Remove {file.fileName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
