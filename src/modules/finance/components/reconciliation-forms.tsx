"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import { MoneyCell } from "./money-cell";
import type {
  reconciliationDetail,
  ReconciliationReview,
} from "../treasury/reconciliation/service";
type Detail = Awaited<ReturnType<typeof reconciliationDetail>>;
async function data(r: Response) {
  const b = await r.json();
  if (!r.ok) throw new Error(b.error.message);
  return b.data;
}
function StatementSourcePicker({
  bank,
  onChange,
}: {
  bank: string;
  onChange: (id: string | null) => void;
}) {
  const uid = useId(),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [pending, setPending] = useState(true),
    [value, setValue] = useState(""),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      items: {
        id: string;
        number: string;
        startDate: string;
        endDate: string;
        closingBalance: string;
      }[];
      page: number;
      pages: number;
      total: number;
    } | null>(null);
  useEffect(() => {
    const c = new AbortController(),
      t = setTimeout(() => {
        setPending(true);
        setError("");
        fetch(
          "/api/v1/finance/statements?" +
            new URLSearchParams({
              cashAccountId: bank,
              state: "IMPORTED",
              q,
              page: String(page),
            }),
          { cache: "no-store", signal: c.signal },
        )
          .then(data)
          .then((r) => {
            setResult(r);
            setPending(false);
          })
          .catch((e) => {
            if (!c.signal.aborted) {
              setError(e.message);
              setPending(false);
            }
          });
      }, 150);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [bank, q, page, retry]);
  const changePage = (n: number) => {
    setPage(n);
    setValue("");
    setPending(true);
    onChange(null);
  };
  return (
    <fieldset>
      <legend>Retained statement source</legend>
      <label htmlFor={uid + "search"}>Search statement source</label>
      <input
        id={uid + "search"}
        maxLength={100}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          changePage(1);
        }}
      />
      <label htmlFor={uid + "select"}>Statement source</label>
      <select
        id={uid + "select"}
        disabled={pending || !!error}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value || null);
        }}
      >
        <option value="">Choose an imported statement</option>
        {result?.items.map((r) => (
          <option key={r.id} value={r.id}>
            {r.number} · {r.startDate} — {r.endDate} · closing{" "}
            {r.closingBalance}
          </option>
        ))}
      </select>
      <p role="status">
        {pending
          ? "Loading statements…"
          : result
            ? result.total +
              " sources · Page " +
              result.page +
              " of " +
              result.pages
            : ""}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry statement sources
          </button>
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          disabled={pending || page <= 1}
          onClick={() => changePage(page - 1)}
        >
          Previous statement source page
        </button>
        <button
          type="button"
          disabled={pending || !result || page >= result.pages}
          onClick={() => changePage(page + 1)}
        >
          Next statement source page
        </button>
      </div>
    </fieldset>
  );
}
export function ReconciliationCreateForm({
  hosted,
  prior,
}: {
  hosted: boolean;
  prior?: Detail["item"];
}) {
  const [bank, setBank] = useState<string | null>(prior?.cashAccountId ?? null),
    [mode, setMode] = useState("STATEMENT"),
    [batch, setBatch] = useState<string | null>(null);
  return (
    <>
      <p>
        Review one retained statement’s closing balance against posted cash at
        its cutoff. A zero-activity review uses explicit equal bank
        opening/closing evidence. Reconciliation creates no ledger entries.
      </p>
      {prior && (
        <p>
          Replacement for{" "}
          <Link href={"/finance/reconciliations/" + prior.id}>
            {prior.number}
          </Link>
          . Keep bank {prior.cashAccount.name} and cutoff {prior.cutoffDate};
          its issued snapshot remains retained.
        </p>
      )}
      <FinanceActionForm
        label="Create reconciliation review"
        endpoint="/api/v1/finance/reconciliations"
        hosted={hosted}
        redirectPrefix="/finance/reconciliations/"
        submitDisabled={!bank || (mode === "STATEMENT" && !batch)}
        business={(f) => ({
          mode,
          cashAccountId: bank,
          ...(mode === "STATEMENT"
            ? { statementBatchId: batch }
            : {
                startDate: String(f.get("startDate")),
                cutoffDate: String(f.get("cutoffDate")),
                openingBalance: String(f.get("openingBalance")),
                closingBalance: String(f.get("closingBalance")),
              }),
          evidence: String(f.get("evidence")),
          replacesId: prior?.id ?? null,
          expectedPriorVersion: prior?.version ?? null,
          reason: String(f.get("reason")),
        })}
      >
        <section aria-label="Choose reconciliation source" className="panel">
          {!prior && (
            <AccountPicker
              kind="statement-bank"
              label="Reconciliation bank"
              value={bank}
              onChange={(v) => {
                setBank(v);
                setBatch(null);
              }}
              required
            />
          )}
          <label htmlFor="reconciliation-mode">Source type</label>
          <select
            id="reconciliation-mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setBatch(null);
            }}
          >
            <option value="STATEMENT">Imported statement</option>
            <option value="ZERO_ACTIVITY">
              No bank activity — explicit balance evidence
            </option>
          </select>
          {bank && mode === "STATEMENT" && (
            <StatementSourcePicker key={bank} bank={bank} onChange={setBatch} />
          )}
        </section>
        <label>
          Review evidence
          <textarea
            name="evidence"
            minLength={3}
            maxLength={1000}
            required
            defaultValue={prior?.evidence}
          />
        </label>
        {mode === "ZERO_ACTIVITY" && (
          <div className="form-grid">
            <label>
              Review start date
              <input
                name="startDate"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                defaultValue={prior?.startDate}
                required
              />
            </label>
            <label>
              Statement cutoff date
              <input
                name="cutoffDate"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                defaultValue={prior?.cutoffDate}
                required
              />
            </label>
            <label>
              Opening bank balance (PKR)
              <input
                name="openingBalance"
                inputMode="decimal"
                defaultValue="0.00"
                maxLength={22}
                required
              />
            </label>
            <label>
              Closing bank balance (PKR)
              <input
                name="closingBalance"
                inputMode="decimal"
                defaultValue="0.00"
                maxLength={22}
                required
              />
            </label>
          </div>
        )}
      </FinanceActionForm>
    </>
  );
}
function DuplicatePeerPicker({
  id,
  rowKey,
  value,
  onChange,
}: {
  id: string;
  rowKey: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const uid = useId(),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [error, setError] = useState(""),
    [pending, setPending] = useState(true),
    [result, setResult] = useState<{
      items: {
        id: string;
        number: string;
        description: string;
        amount: string;
      }[];
      page: number;
      pages: number;
      total: number;
    } | null>(null);
  useEffect(() => {
    const c = new AbortController(),
      t = setTimeout(() => {
        setPending(true);
        setError("");
        fetch(
          "/api/v1/finance/reconciliations/" +
            id +
            "/peers?" +
            new URLSearchParams({ rowKey, q, page: String(page) }),
          { cache: "no-store", signal: c.signal },
        )
          .then(data)
          .then((r) => {
            setResult(r);
            setPending(false);
          })
          .catch((e) => {
            if (!c.signal.aborted) {
              setError(e.message);
              setPending(false);
            }
          });
      }, 150);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [id, rowKey, q, page, retry]);
  return (
    <fieldset>
      <legend>Fully matched duplicate peer</legend>
      <label htmlFor={uid + "search"}>Search duplicate peer</label>
      <input
        id={uid + "search"}
        value={q}
        maxLength={100}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
          setPending(true);
          onChange(null);
        }}
      />
      <label htmlFor={uid + "value"}>Matched original record</label>
      <select
        id={uid + "value"}
        value={value ?? ""}
        disabled={pending || !!error}
        required
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Choose an exact fully matched peer</option>
        {result?.items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.number} · {i.amount} · {i.description}
          </option>
        ))}
      </select>
      <p role="status">
        {pending
          ? "Checking original cash matches…"
          : result
            ? result.total +
              " eligible peers · Page " +
              result.page +
              " of " +
              result.pages
            : ""}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry peers
          </button>
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          disabled={pending || page <= 1}
          onClick={() => {
            setPage((n) => n - 1);
            setPending(true);
            onChange(null);
          }}
        >
          Previous peer page
        </button>
        <button
          type="button"
          disabled={pending || !result || page >= result.pages}
          onClick={() => {
            setPage((n) => n + 1);
            setPending(true);
            onChange(null);
          }}
        >
          Next peer page
        </button>
      </div>
    </fieldset>
  );
}
export function ReconciliationNotes({
  id,
  version,
  items,
  hosted,
  page,
}: {
  id: string;
  version: number;
  items: ReconciliationReview["items"];
  hosted: boolean;
  page: number;
}) {
  const [reviews, setReviews] = useState<
    Record<
      string,
      { kind: "DOCUMENT" | "EXCLUDE_DUPLICATE"; peer: string | null }
    >
  >(() =>
    Object.fromEntries(
      items.map((i) => [
        i.key,
        {
          kind: i.review?.kind ?? "DOCUMENT",
          peer: i.review?.peerStatementLineId ?? null,
        },
      ]),
    ),
  );
  return (
    <FinanceActionForm
      label="Save this page’s item reviews"
      endpoint={"/api/v1/finance/reconciliations/" + id + "/notes"}
      hosted={hosted}
      business={(f) => ({
        expectedVersion: version,
        notes: items.map((i) => ({
          rowKey: i.key,
          kind: reviews[i.key].kind,
          note: String(f.get(i.key)),
          peerStatementLineId: reviews[i.key].peer,
        })),
        reason: String(f.get("reason")),
      })}
    >
      {items.map((i, n) => (
        <fieldset key={i.key}>
          <legend>
            Item {(page - 1) * 25 + n + 1}:{" "}
            {i.source.kind === "CASH"
              ? "Outstanding cash"
              : "Unresolved bank record"}
          </legend>
          <p>
            {i.source.date} · {i.source.direction} ·{" "}
            {i.source.number ?? i.source.reference} · Remaining{" "}
            <MoneyCell value={i.remaining} />
          </p>
          <p>{i.source.description}</p>
          <label>
            Documentation for item {(page - 1) * 25 + n + 1}
            <textarea
              name={i.key}
              minLength={3}
              maxLength={500}
              defaultValue={i.review?.note ?? ""}
              required
            />
          </label>
          {i.source.kind === "STATEMENT" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={reviews[i.key].kind === "EXCLUDE_DUPLICATE"}
                  onChange={(e) =>
                    setReviews((r) => ({
                      ...r,
                      [i.key]: {
                        kind: e.target.checked
                          ? "EXCLUDE_DUPLICATE"
                          : "DOCUMENT",
                        peer: null,
                      },
                    }))
                  }
                />
                Explicitly review item {(page - 1) * 25 + n + 1} as a duplicate
              </label>
              <p>
                A comment alone does not resolve a bank record. Use the normal
                posting/matching workflow, or choose a genuine exact duplicate
                already fully matched to real cash.
              </p>
              {reviews[i.key].kind === "EXCLUDE_DUPLICATE" && (
                <DuplicatePeerPicker
                  id={id}
                  rowKey={i.key}
                  value={reviews[i.key].peer}
                  onChange={(peer) =>
                    setReviews((r) => ({
                      ...r,
                      [i.key]: { ...r[i.key], peer },
                    }))
                  }
                />
              )}
            </>
          )}
        </fieldset>
      ))}
    </FinanceActionForm>
  );
}
export function ReconciliationAction({
  id,
  version,
  action,
  label,
  hosted,
  disabled = false,
}: {
  id: string;
  version: number;
  action: "REFRESH" | "FINALIZE" | "VOID" | "REOPEN";
  label: string;
  hosted: boolean;
  disabled?: boolean;
}) {
  return (
    <FinanceActionForm
      label={label}
      endpoint={
        "/api/v1/finance/reconciliations/" + id + "/" + action.toLowerCase()
      }
      hosted={hosted}
      disabled={disabled}
      business={(f) => ({
        expectedVersion: version,
        reason: String(f.get("reason")),
      })}
    />
  );
}
