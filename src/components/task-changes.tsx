"use client";
import { useRef, useState } from "react";
import { MutationForm } from "./mutation-form";
import { TextareaField } from "./textarea-field";
type Preview = {
  valid: boolean;
  id?: string;
  expiresAt?: string;
  count: number;
  errors: { row?: number; id?: string; message: string }[];
  sample: Record<string, unknown>[];
  updates?: Record<string, unknown>;
};
function PreviewDetails({
  preview,
  kind,
  onCommitted,
}: {
  preview: Preview;
  kind: "bulk" | "import";
  onCommitted: (count: number) => void;
}) {
  return (
    <section aria-label="Change preview" className="preview-box">
      <h3>
        {preview.valid ? "Ready to commit" : "Preview needs attention"} ·{" "}
        {preview.count} tasks
      </h3>
      {preview.errors.length > 0 && (
        <div role="alert" className="error">
          <ul>
            {preview.errors.map((e, i) => (
              <li key={i}>
                {e.row ? `Row ${e.row}: ` : ""}
                {e.id ? e.id + ": " : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.updates && (
        <p>
          Apply{" "}
          {Object.entries(preview.updates)
            .map(([k, v]) => `${k}: ${v ?? "clear"}`)
            .join(" · ")}
        </p>
      )}
      {preview.sample.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {Object.keys(preview.sample[0]).map((k) => (
                  <th key={k}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((v, n) => (
                    <td key={n}>{String(v ?? "—")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {preview.valid && preview.id && (
        <>
          <p className="note">
            {kind === "import"
              ? "Up to 10 sample rows shown; the entire file was validated. "
              : ""}
            Preview expires {preview.expiresAt}. Permissions and versions are
            checked again at commit.
          </p>
          <MutationForm
            endpoint={
              kind === "import"
                ? "/api/v1/imports/tasks/commit"
                : "/api/v1/tasks/bulk-commit"
            }
            label={
              kind === "import" ? "Commit task import" : "Commit bulk changes"
            }
            transform={() => ({ previewId: preview.id })}
            onSuccess={(data) =>
              onCommitted(Number((data as { count?: number })?.count ?? 0))
            }
          >
            <label className="file-choice">
              <input type="checkbox" required />I reviewed this preview and
              confirm all {preview.count} tasks
            </label>
          </MutationForm>
        </>
      )}
    </section>
  );
}
export function BulkTaskChanges({
  items,
  onCommitted,
}: {
  items: { id: string; expectedVersion: number }[];
  onCommitted: (count: number) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const retry = useRef<{ body: string; key: string } | null>(null);
  return (
    <section className="panel">
      <h2>Bulk task changes · {items.length} selected</h2>
      <form
        onChange={() => setPreview(null)}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            updates: Record<string, unknown> = {};
          if (f.get("priority")) updates.priority = f.get("priority");
          if (f.get("clearDeadline") === "on") updates.dueAt = null;
          else if (f.get("dueAt"))
            updates.dueAt = new Date(
              String(f.get("dueAt")) + ":00+05:00",
            ).toISOString();
          const body = JSON.stringify({
            items,
            updates,
            reason: f.get("reason"),
          });
          if (retry.current?.body !== body)
            retry.current = { body, key: crypto.randomUUID() };
          setPending(true);
          setError("");
          try {
            const r = await fetch("/api/v1/tasks/bulk-preview", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Encova-CSRF": "1",
                "Idempotency-Key": retry.current.key,
              },
              body,
            });
            const json = await r.json();
            if (!r.ok)
              throw new Error(json.error?.message ?? "Unable to preview.");
            setPreview(json.data);
            retry.current = null;
          } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to preview.");
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset className="mutation-fields" disabled={pending}>
          <div className="form-grid">
            <label>
              Bulk priority
              <select name="priority">
                <option value="">Keep priority unchanged</option>
                {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Bulk deadline (Asia/Karachi)
              <input name="dueAt" type="datetime-local" />
            </label>
          </div>
          <label className="file-choice">
            <input type="checkbox" name="clearDeadline" />
            Clear selected task deadlines
          </label>
          <TextareaField
            label="Reason for bulk change"
            name="reason"
            required
            maxLength={1000}
          />
          <button className="primary">
            {pending ? "Checking…" : "Preview bulk changes"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <PreviewDetails
          preview={preview}
          kind="bulk"
          onCommitted={onCommitted}
        />
      )}
    </section>
  );
}
export function CsvTaskImport({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const retry = useRef<{ fingerprint: string; key: string } | null>(null),
    formRef = useRef<HTMLFormElement>(null);
  return (
    <section className="panel">
      <h2>Import new tasks from CSV</h2>
      <p className="note">
        UTF-8 CSV, up to 500 rows and 2 MB. Required headers: title, assignee,
        reviewer. Optional: description, priority, due_at (ISO date/time with
        timezone). Use active project usernames; reviewed work remains
        independent.
      </p>
      <form
        ref={formRef}
        onChange={() => {
          setPreview(null);
          setMessage("");
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            file = f.get("file");
          if (!(file instanceof File) || !file.size) {
            setError("Choose a CSV file.");
            return;
          }
          if (file.size > 2097152) {
            setError("CSV exceeds 2 MB.");
            return;
          }
          setPending(true);
          setError("");
          try {
            const bytes = await file.arrayBuffer(),
              hash = Array.from(
                new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              )
                .map((v) => v.toString(16).padStart(2, "0"))
                .join(""),
              fingerprint = String(f.get("projectId")) + hash;
            if (retry.current?.fingerprint !== fingerprint)
              retry.current = { fingerprint, key: crypto.randomUUID() };
            const r = await fetch(
              "/api/v1/imports/tasks/preview?projectId=" +
                encodeURIComponent(String(f.get("projectId"))),
              {
                method: "POST",
                headers: {
                  "Content-Type": "text/csv",
                  "X-Encova-CSRF": "1",
                  "Idempotency-Key": retry.current.key,
                },
                body: bytes,
              },
            );
            const json = await r.json();
            if (!r.ok)
              throw new Error(json.error?.message ?? "Unable to preview CSV.");
            setPreview(json.data);
            retry.current = null;
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Unable to preview CSV.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset className="mutation-fields" disabled={pending}>
          <div className="form-grid">
            <label>
              Import project
              <select name="projectId" required>
                <option value="">Select managed project</option>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Task CSV file
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
          </div>
          <button className="primary">
            {pending ? "Checking…" : "Preview CSV import"}
          </button>
        </fieldset>
      </form>
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
      {preview && (
        <PreviewDetails
          preview={preview}
          kind="import"
          onCommitted={(count) => {
            setMessage(`Imported ${count} tasks.`);
            setPreview(null);
            formRef.current?.reset();
          }}
        />
      )}
    </section>
  );
}
