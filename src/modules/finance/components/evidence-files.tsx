"use client";
import { useSyncExternalStore, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FinanceActionForm } from "./finance-action-form";
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
export type EvidenceFile = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  state: string;
  blobDeletedAt: string | null;
};
export function EvidenceDownload({ file }: { file: EvidenceFile }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const bytes = new Uint8Array(file.byteSize),
              chunk = 3 * 1024 * 1024;
            for (let start = 0; start < file.byteSize; start += chunk) {
              const end = Math.min(file.byteSize - 1, start + chunk - 1),
                r = await fetch(
                  "/api/v1/finance/attachments/" + file.id + "/download",
                  {
                    headers: { Range: `bytes=${start}-${end}` },
                    cache: "no-store",
                  },
                );
              if (!r.ok) {
                const body = await r.json();
                throw Error(body.error?.message ?? "Evidence unavailable.");
              }
              if (
                r.status !== 206 ||
                r.headers.get("Content-Range") !==
                  `bytes ${start}-${end}/${file.byteSize}` ||
                r.headers.get("X-Content-SHA256") !== file.sha256
              )
                throw Error("File verification failed. Reload and try again.");
              const part = new Uint8Array(await r.arrayBuffer());
              if (part.length !== end - start + 1)
                throw Error("The download was interrupted. Try again.");
              bytes.set(part, start);
            }
            const digest = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            )
              .map((x) => x.toString(16).padStart(2, "0"))
              .join("");
            if (digest !== file.sha256)
              throw Error("File contents could not be verified.");
            const url = URL.createObjectURL(
                new Blob([bytes], { type: file.mimeType }),
              ),
              a = document.createElement("a");
            a.href = url;
            a.download = file.fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Download unavailable.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Verifying download…" : "Download " + file.fileName}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function EvidenceUpload({
  sourceType,
  sourceId,
  hosted,
  disabled = false,
}: {
  sourceType: string;
  sourceId: string;
  hosted: boolean;
  disabled?: boolean;
}) {
  const router = useRouter(),
    key = useRef<string>(crypto.randomUUID()),
    ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  return (
    <form
      method="post"
      action="/api/v1/finance/attachments"
      encType="multipart/form-data"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          f = new FormData(form);
        setBusy(true);
        setError("");
        setStatus("");
        try {
          const file = f.get("file");
          if (
            !(file instanceof File) ||
            !file.size ||
            file.size > 10 * 1024 * 1024 ||
            !["application/pdf", "image/png", "image/jpeg"].includes(file.type)
          )
            throw Error("Choose a PDF, PNG or JPEG file up to 10 MB.");
          const data = await file.arrayBuffer(),
            sha256 = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
            )
              .map((x) => x.toString(16).padStart(2, "0"))
              .join("");
          const send = async (path: string, body: unknown, reauth = false) => {
            const r = await fetch("/api/v1/finance/attachments" + path, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Encova-CSRF": "1",
                  ...(reauth ? { "Idempotency-Key": key.current } : {}),
                },
                body: JSON.stringify(body),
              }),
              json = await r.json();
            if (!r.ok)
              throw Error(json.error?.message ?? "Evidence upload failed.");
            return json.data;
          };
          setStatus("Authorizing upload…");
          const reserved = await send(
            "",
            {
              sourceType,
              sourceId,
              fileName: file.name,
              mimeType: file.type,
              byteSize: file.size,
              sha256,
              reason: String(f.get("reason")),
              reauth: {
                password: String(f.get("password")),
                ...(hosted ? { code: String(f.get("code")) } : {}),
              },
            },
            true,
          );
          for (const name of ["password", "code"]) {
            const input = form.elements.namedItem(name);
            if (input instanceof HTMLInputElement) input.value = "";
          }
          if (reserved.uploadUrl) {
            setStatus("Uploading evidence…");
            const uploaded = await fetch(reserved.uploadUrl, {
              method: "PUT",
              headers: {
                "Content-Type": file.type,
                "Cache-Control": "max-age=0",
                "x-upsert": "false",
              },
              body: data,
            });
            if (!uploaded.ok && uploaded.status !== 409)
              throw Error(
                "Upload interrupted. Retry the same file to recover.",
              );
          }
          if (reserved.intent) {
            setStatus("Verifying evidence…");
            await send("/" + reserved.file.id + "/complete", {
              intent: reserved.intent,
            });
            const scanned = await send("/" + reserved.file.id + "/scan", {
              intent: reserved.intent,
            });
            setStatus(
              scanned.file.state === "CLEAN"
                ? "Evidence verified and ready to download."
                : scanned.file.state === "REJECTED"
                  ? "This evidence did not pass its security scan."
                  : "Evidence uploaded. Awaiting security scan.",
            );
          } else setStatus("Evidence already recorded.");
          key.current = crypto.randomUUID();
          router.refresh();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Evidence upload unavailable.",
          );
        } finally {
          for (const name of ["password", "code"]) {
            const input = form.elements.namedItem(name);
            if (input instanceof HTMLInputElement) input.value = "";
          }
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={!ready || busy || disabled}>
        <legend>Add private evidence</legend>
        <label>
          Evidence file
          <input
            name="file"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            required
            onChange={() => {
              key.current = crypto.randomUUID();
              setError("");
            }}
          />
        </label>
        <p>
          PDF, PNG or JPEG · up to 10 MB · ten files per document. Downloads
          become available after a verified security scan.
        </p>
        <label>
          Evidence reason
          <input name="reason" required minLength={3} maxLength={500} />
        </label>
        <label>
          Current password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        {hosted && (
          <label>
            Fresh authenticator code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
            />
          </label>
        )}
        <button type="submit">
          {busy ? "Uploading evidence…" : "Upload private evidence"}
        </button>
      </fieldset>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function EvidenceActions({
  file,
  hosted,
  canRemove = false,
}: {
  file: EvidenceFile;
  hosted: boolean;
  canRemove?: boolean;
}) {
  return (
    <div>
      {file.state === "CLEAN" && <EvidenceDownload file={file} />}
      <p>
        {file.state === "QUARANTINED"
          ? "Awaiting security scan"
          : file.state.toLowerCase()}
        {file.state === "REMOVED" && !file.blobDeletedAt
          ? " · private storage cleanup pending"
          : ""}
      </p>
      {["RESERVED", "QUARANTINED"].includes(file.state) && (
        <FinanceActionForm
          label="Retry evidence verification"
          hosted={hosted}
          endpoint={"/api/v1/finance/attachments/" + file.id + "/scan"}
          business={(f) => ({ reason: String(f.get("reason")) })}
        >
          <p>Verify the uploaded file and request its security scan again.</p>
        </FinanceActionForm>
      )}
      {canRemove && file.state !== "REMOVED" && (
        <FinanceActionForm
          label="Remove draft evidence"
          hosted={hosted}
          endpoint={"/api/v1/finance/attachments/" + file.id + "/remove"}
          business={(f) => ({ reason: String(f.get("reason")) })}
        >
          <label className="check-label">
            <input type="checkbox" required />
            Remove this draft file while retaining its history.
          </label>
        </FinanceActionForm>
      )}
    </div>
  );
}
