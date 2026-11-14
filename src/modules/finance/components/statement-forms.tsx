"use client";
import Link from "next/link";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import { MoneyCell } from "./money-cell";
import {
  MAX_STATEMENT_BYTES,
  STATEMENT_CHUNK_BYTES,
} from "../treasury/statements/limits";
import type {
  statementUpload,
  statementGrid,
  previewStatement,
  statementBatch,
} from "../treasury/statements/service";
type Upload = Awaited<ReturnType<typeof statementUpload>>;
type Grid = Awaited<ReturnType<typeof statementGrid>>;
type Preview = Awaited<ReturnType<typeof previewStatement>>;
type Batch = Awaited<ReturnType<typeof statementBatch>>["item"];
type Replacement = {
  id: string;
  number: string;
  cashAccountId: string;
  cashAccountName: string;
};
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
async function data(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      [
        body.error.message,
        ...Object.entries(body.error.fields?.fieldErrors ?? {}).map(
          ([k, v]) => k + ": " + (v as string[]).join(" "),
        ),
        ...(body.error.fields?.formErrors ?? []),
      ].join(" "),
    );
  return body.data;
}
async function digest(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function base64(bytes: Uint8Array) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
export function StatementImportForm({
  hosted,
  replacement,
}: {
  hosted: boolean;
  replacement?: Replacement;
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [cash, setCash] = useState<string | null>(
      replacement?.cashAccountId ?? null,
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [stage, setStage] = useState<Upload | null>(null),
    [review, setReview] = useState<{ upload: Upload; grid: Grid } | null>(null),
    [existing, setExisting] = useState<{
      id: string;
      number: string;
      state: string;
    } | null>(null),
    retry = useRef<{ body: string; key: string } | null>(null);
  if (review)
    return (
      <StatementReview
        key={review.upload.id}
        upload={review.upload}
        initialGrid={review.grid}
        hosted={hosted}
        onCancelled={() => {
          setReview(null);
          setStage(null);
          setError("");
          retry.current = null;
        }}
      />
    );
  return (
    <>
      {replacement && (
        <p>
          Reviewed replacement for {replacement.number}. Its original evidence
          and correction history will be retained.
        </p>
      )}
      <section className="panel" aria-label="Upload statement for review">
        <h2>Choose statement evidence</h2>
        <p>
          CSV · PKR · maximum 5 MB (5,000,000 bytes) and 5,000 data rows. This
          upload does not record money or an accounting entry.
        </p>
        <form
          method="post"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              fields = new FormData(form);
            setPending(true);
            setError("");
            setExisting(null);
            try {
              const file = fields.get("file");
              if (
                !(file instanceof File) ||
                file.size === 0 ||
                file.size > MAX_STATEMENT_BYTES ||
                !/\.csv$/i.test(file.name)
              )
                throw new Error(
                  "Choose a nonempty .csv file no larger than 5 MB.",
                );
              setProgress("Checking the selected file…");
              const buffer = await file.arrayBuffer(),
                body = {
                  cashAccountId: cash,
                  fileName: file.name,
                  byteSize: file.size,
                  sha256: await digest(buffer),
                  replacesId: replacement?.id ?? null,
                  reason: String(fields.get("reason")),
                },
                fingerprint = JSON.stringify(body);
              if (retry.current?.body !== fingerprint)
                retry.current = { body: fingerprint, key: crypto.randomUUID() };
              const reserved = await data(
                await fetch("/api/v1/finance/statement-uploads", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-encova-csrf": "1",
                    "idempotency-key": retry.current.key,
                  },
                  body: JSON.stringify({
                    ...body,
                    reauth: {
                      password: String(fields.get("password")),
                      ...(hosted ? { code: String(fields.get("code")) } : {}),
                    },
                  }),
                }),
              );
              if (reserved.batch) {
                setExisting(reserved.batch);
                setProgress(
                  "This file already has retained statement evidence.",
                );
                return;
              }
              const upload = reserved.upload as Upload;
              setStage(upload);
              if (!reserved.intent) {
                retry.current = null;
                throw new Error(
                  "This upload is already closed. Review its retained statement or upload again to start a new source.",
                );
              }
              const total = Math.ceil(
                buffer.byteLength / STATEMENT_CHUNK_BYTES,
              );
              for (let index = 0; index < total; index++) {
                const part = buffer.slice(
                    index * STATEMENT_CHUNK_BYTES,
                    (index + 1) * STATEMENT_CHUNK_BYTES,
                  ),
                  sha256 = await digest(part),
                  received = upload.chunks.find((c) => c.index === index);
                setProgress(
                  "Uploading statement data " +
                    (index + 1) +
                    " of " +
                    total +
                    "…",
                );
                if (received) {
                  if (received.sha256 !== sha256)
                    throw new Error(
                      "Reserved data differs from this file. Cancel the pending upload and choose the original file.",
                    );
                  continue;
                }
                await data(
                  await fetch(
                    "/api/v1/finance/statement-uploads/" +
                      upload.id +
                      "/chunks",
                    {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                        "x-encova-csrf": "1",
                      },
                      body: JSON.stringify({
                        index,
                        content: base64(new Uint8Array(part)),
                        sha256,
                        intent: reserved.intent,
                      }),
                    },
                  ),
                );
              }
              const current = await data(
                await fetch("/api/v1/finance/statement-uploads/" + upload.id, {
                  cache: "no-store",
                }),
              );
              setStage(current);
              const grid = await data(
                await fetch(
                  "/api/v1/finance/statement-uploads/" + upload.id + "/grid",
                  { cache: "no-store" },
                ),
              );
              setReview({ upload: current, grid });
              retry.current = null;
              setProgress("");
            } catch (e) {
              setProgress("");
              setError(
                e instanceof Error
                  ? e.message
                  : "Unable to upload statement evidence.",
              );
            } finally {
              for (const name of ["password", "code"]) {
                const field = form.elements.namedItem(name);
                if (field instanceof HTMLInputElement) field.value = "";
              }
              setPending(false);
            }
          }}
        >
          <fieldset disabled={!ready || pending} className="mutation-fields">
            {replacement ? (
              <p>Bank/cash account: {replacement.cashAccountName}</p>
            ) : (
              <AccountPicker
                kind="statement-bank"
                label="Statement bank/cash account"
                value={cash}
                onChange={(id) => {
                  setCash(id);
                  retry.current = null;
                }}
                required
              />
            )}
            <label>
              Statement CSV
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
            <label>
              Reason
              <input name="reason" minLength={3} maxLength={500} required />
            </label>
            <label>
              Current password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                maxLength={128}
                required
              />
            </label>
            {hosted && (
              <label>
                Fresh authenticator code
                <input
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                />
              </label>
            )}
            {error && <p role="alert">{error}</p>}
            <button type="submit" className="primary">
              {pending ? "Uploading…" : "Upload statement for preview"}
            </button>
          </fieldset>
        </form>
        <p role="status">{progress}</p>
        {existing && (
          <p>
            This file’s retained import is {existing.state.toLowerCase()}.{" "}
            <Link href={"/finance/statements/" + existing.id}>
              Open {existing.number}
            </Link>
          </p>
        )}
      </section>
      {stage && stage.state === "UPLOADING" && error && (
        <section className="panel" aria-label="Cancel pending statement upload">
          <h2>Pending upload</h2>
          <p>
            Retry with the same file to resume its retained data, or cancel
            before choosing different evidence.
          </p>
          <FinanceActionForm
            hosted={hosted}
            label="Cancel statement upload"
            endpoint={
              "/api/v1/finance/statement-uploads/" + stage.id + "/cancel"
            }
            onSaved={() => {
              setStage(null);
              setError("");
              retry.current = null;
            }}
            onReload={() => {
              void fetch("/api/v1/finance/statement-uploads/" + stage.id, {
                cache: "no-store",
              })
                .then(data)
                .then(setStage)
                .catch(() => {});
            }}
            business={(f) => ({
              expectedVersion: stage.version,
              reason: String(f.get("reason")),
            })}
          />
          <p>
            If transferred data changed the version, retry the upload to reload
            its current status before cancelling.
          </p>
        </section>
      )}
    </>
  );
}
function StatementReview({
  upload,
  initialGrid,
  hosted,
  onCancelled,
}: {
  upload: Upload;
  initialGrid: Grid;
  hosted: boolean;
  onCancelled: () => void;
}) {
  const id = useId(),
    [grid, setGrid] = useState(initialGrid),
    [skip, setSkip] = useState("0"),
    [mode, setMode] = useState("SIGNED"),
    [format, setFormat] = useState("ISO"),
    [positive, setPositive] = useState("RECEIPT"),
    [dateColumn, setDate] = useState("0"),
    [amountColumn, setAmount] = useState("1"),
    [debitColumn, setDebit] = useState("1"),
    [creditColumn, setCredit] = useState("2"),
    [descriptionColumn, setDescription] = useState(
      initialGrid.headers.length > 2 ? "2" : "",
    ),
    [referenceColumn, setReference] = useState(
      initialGrid.headers.length > 3 ? "3" : "",
    ),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ack, setAck] = useState(false),
    [sourceVersion, setSourceVersion] = useState(upload.version),
    lastMetadata = useRef<Record<string, unknown> | null>(null);
  const column = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    optional = false,
  ) => (
    <div>
      <label htmlFor={id + label.replace(/[^a-zA-Z0-9]/g, "-")}>{label}</label>
      <select
        id={id + label.replace(/[^a-zA-Z0-9]/g, "-")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={!optional}
      >
        {optional && <option value="">Not mapped</option>}
        {grid.headers.map((h) => (
          <option key={h.index} value={h.index}>
            {h.index + 1}. {h.name}
          </option>
        ))}
      </select>
    </div>
  );
  const field = (
    name: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: [string, string][],
  ) => (
    <div>
      <label htmlFor={id + name}>{label}</label>
      <select
        id={id + name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
  async function show(metadata: Record<string, unknown>, page = 1) {
    setBusy(true);
    setError("");
    try {
      const next = await data(
        await fetch(
          "/api/v1/finance/statement-uploads/" +
            upload.id +
            "/preview?page=" +
            page,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-encova-csrf": "1",
            },
            body: JSON.stringify(metadata),
          },
        ),
      );
      setPreview(next);
      setSourceVersion(next.uploadVersion);
      lastMetadata.current = metadata;
      setAck(false);
    } catch (e) {
      setPreview(null);
      setError(
        e instanceof Error ? e.message : "Unable to preview the statement.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h2>Map and validate statement</h2>
        <p>
          {upload.fileName} · {upload.cashAccount.name} · PKR · {grid.dataRows}{" "}
          data records after the selected header
        </p>
        <p>
          Review the column mapping and explicit date format. Enter the opening
          and closing balances from the statement. Bank evidence does not
          automatically create income or payments.
        </p>
        <form
          method="post"
          onChange={() => {
            setPreview(null);
            setAck(false);
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              mapping = {
                mode,
                skipRows: Number(skip),
                dateColumn: Number(dateColumn),
                dateFormat: format,
                descriptionColumn:
                  descriptionColumn === "" ? null : Number(descriptionColumn),
                referenceColumn:
                  referenceColumn === "" ? null : Number(referenceColumn),
                ...(mode === "SIGNED"
                  ? {
                      amountColumn: Number(amountColumn),
                      positiveMeans: positive,
                    }
                  : {
                      debitColumn: Number(debitColumn),
                      creditColumn: Number(creditColumn),
                    }),
              };
            await show({
              mapping,
              startDate: String(f.get("startDate")),
              endDate: String(f.get("endDate")),
              openingBalance: String(f.get("openingBalance")),
              closingBalance: String(f.get("closingBalance")),
              currency: "PKR",
            });
          }}
        >
          <fieldset disabled={busy} className="mutation-fields">
            <label>
              Records before header
              <input
                type="number"
                min={0}
                max={25}
                value={skip}
                onChange={(e) => setSkip(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                setPreview(null);
                setError("");
                try {
                  setGrid(
                    await data(
                      await fetch(
                        "/api/v1/finance/statement-uploads/" +
                          upload.id +
                          "/grid?skipRows=" +
                          skip,
                        { cache: "no-store" },
                      ),
                    ),
                  );
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Unable to use that header.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Use selected header
            </button>
            {column("Bank value date column", dateColumn, setDate)}
            {field("dateformat", "Date format", format, setFormat, [
              ["ISO", "YYYY-MM-DD"],
              ["DMY", "DD/MM/YYYY"],
              ["MDY", "MM/DD/YYYY"],
            ])}
            {field("amountmode", "Amount columns", mode, setMode, [
              ["SIGNED", "One signed amount"],
              ["DEBIT_CREDIT", "Separate money-out / money-in"],
            ])}
            {mode === "SIGNED" ? (
              <>
                {column("Signed amount column", amountColumn, setAmount)}
                {field(
                  "positivemeans",
                  "Positive amount means",
                  positive,
                  setPositive,
                  [
                    ["RECEIPT", "Money in"],
                    ["PAYMENT", "Money out"],
                  ],
                )}
              </>
            ) : (
              <>
                {column("Money-out column", debitColumn, setDebit)}
                {column("Money-in column", creditColumn, setCredit)}
              </>
            )}
            {column(
              "Description column",
              descriptionColumn,
              setDescription,
              true,
            )}
            {column(
              "Bank reference column",
              referenceColumn,
              setReference,
              true,
            )}
            <label>
              Statement start date
              <input name="startDate" type="date" required />
            </label>
            <label>
              Statement end date
              <input name="endDate" type="date" required />
            </label>
            <label>
              Opening statement balance (PKR)
              <input
                name="openingBalance"
                inputMode="decimal"
                required
                placeholder="0.00"
              />
            </label>
            <label>
              Closing statement balance (PKR)
              <input
                name="closingBalance"
                inputMode="decimal"
                required
                placeholder="0.00"
              />
            </label>
            <p>
              Use dot-decimal amounts; comma thousands must be grouped
              correctly. Negative opening/closing balances are supported.
            </p>
            <button type="submit" className="primary">
              {busy ? "Validating…" : "Preview mapped statement"}
            </button>
          </fieldset>
        </form>
        {error && <p role="alert">{error}</p>}
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="CSV sample records"
        >
          <table>
            <thead>
              <tr>
                <th>Record</th>
                {grid.headers.map((h) => (
                  <th key={h.index}>
                    {h.index + 1}. {h.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.sample.map((r) => (
                <tr key={r.sourceRow}>
                  <td>{r.sourceRow}</td>
                  {r.cells.map((c, i) => (
                    <td key={i}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {preview && (
        <>
          <section className="panel" aria-label="Mapped statement preview">
            <h2>Mapped statement preview</h2>
            <p>
              {preview.rowCount} records · Money in{" "}
              <MoneyCell value={preview.receipts} /> · Money out{" "}
              <MoneyCell value={preview.payments} /> · Source balance difference{" "}
              <MoneyCell value={preview.difference} />
            </p>
            <p>
              {preview.balanced
                ? "The statement opening, flows and closing balance agree."
                : "Correct the stated balances or mapping before importing."}{" "}
              This validates the source totals. The posted bank balance and
              outstanding items require a separate reconciliation.
            </p>
            <p>
              {preview.duplicateCount} potential duplicate records require
              explicit review. All original records are retained.
            </p>
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Mapped bank records"
            >
              <table>
                <thead>
                  <tr>
                    <th>CSV record</th>
                    <th>Value date</th>
                    <th>Direction</th>
                    <th>Amount (PKR)</th>
                    <th>Description / reference</th>
                    <th>Duplicate evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => {
                    const d = preview.duplicateEvidence.find(
                      (d) => d.sourceRow === r.sourceRow,
                    );
                    return (
                      <tr key={r.sequence}>
                        <td>{r.sourceRow}</td>
                        <td>{r.valueDate}</td>
                        <td>{r.direction}</td>
                        <td>
                          <MoneyCell value={r.amount} />
                        </td>
                        <td>
                          {r.description} · {r.bankReference}
                        </td>
                        <td>
                          {d ? (
                            <>
                              {d.existingCount} existing records ·{" "}
                              {d.withinSourceCount} in this file
                              {d.sampleLines.map((l) => (
                                <p key={l.id}>
                                  <Link
                                    href={"/finance/statements/" + l.batchId}
                                  >
                                    Review prior statement
                                  </Link>
                                </p>
                              ))}
                            </>
                          ) : (
                            "No candidate"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              Page {preview.page} of {preview.pages}
            </p>
            {preview.page > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void show(lastMetadata.current!, preview.page - 1)
                }
              >
                Previous mapped records
              </button>
            )}
            {preview.page < preview.pages && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void show(lastMetadata.current!, preview.page + 1)
                }
              >
                Next mapped records
              </button>
            )}
            {preview.duplicateCount > 0 && (
              <label>
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                I reviewed all {preview.duplicateCount} potential duplicate
                records and want to retain them.
              </label>
            )}
          </section>
          <section className="panel" aria-label="Confirm statement import">
            <h2>Confirm reviewed statement</h2>
            <FinanceActionForm
              hosted={hosted}
              label="Import reviewed statement"
              endpoint={
                "/api/v1/finance/statement-uploads/" + upload.id + "/import"
              }
              redirectPrefix="/finance/statements/"
              disabled={
                busy ||
                !preview.balanced ||
                (preview.duplicateCount > 0 && !ack)
              }
              business={(f) => ({
                ...preview.metadata,
                expectedVersion: preview.uploadVersion,
                basisHash: preview.basisHash,
                acknowledgedRows:
                  preview.duplicateCount > 0 && ack
                    ? preview.duplicateRows
                    : [],
                duplicateReview: String(f.get("duplicateReview") ?? ""),
                reason: String(f.get("reason")),
              })}
              onReload={() => {
                setPreview(null);
                setAck(false);
              }}
            >
              {preview.duplicateCount > 0 && (
                <label>
                  Duplicate review reason
                  <textarea
                    name="duplicateReview"
                    minLength={3}
                    maxLength={1000}
                    required
                  />
                </label>
              )}
            </FinanceActionForm>
            <p>
              Import retains this reviewed evidence and does not post money,
              match transactions or mark the bank reconciled.
            </p>
          </section>
        </>
      )}
      <section className="panel" aria-label="Cancel pending statement upload">
        <h2>Discard this pending import</h2>
        <FinanceActionForm
          hosted={hosted}
          label="Cancel statement upload"
          endpoint={
            "/api/v1/finance/statement-uploads/" + upload.id + "/cancel"
          }
          business={(f) => ({
            expectedVersion: sourceVersion,
            reason: String(f.get("reason")),
          })}
          onSaved={onCancelled}
          onReload={() => {
            void fetch("/api/v1/finance/statement-uploads/" + upload.id, {
              cache: "no-store",
            })
              .then(data)
              .then((u) => setSourceVersion(u.version))
              .catch((e) =>
                setError(
                  e instanceof Error ? e.message : "Unable to reload upload.",
                ),
              );
          }}
        />
        <p>Cancellation retains its source history and records no money.</p>
      </section>
    </>
  );
}
export function StatementVoidForm({
  item,
  hosted,
}: {
  item: Batch;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Void statement import"
      endpoint={"/api/v1/finance/statements/" + item.id + "/void"}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    />
  );
}
