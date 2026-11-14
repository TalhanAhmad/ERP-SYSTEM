"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import { MoneyCell } from "./money-cell";
import type { MatchPosition, MatchPreview } from "../treasury/matching/service";
async function data(response: Response) {
  const b = await response.json();
  if (!response.ok)
    throw new Error(
      [
        b.error.message,
        ...Object.entries(b.error.fields?.fieldErrors ?? {}).map(
          ([k, v]) => k + ": " + (v as string[]).join(" "),
        ),
        ...(b.error.fields?.formErrors ?? []),
      ].join(" "),
    );
  return b.data;
}
function MatchPicker({
  kind,
  bank,
  onChoose,
}: {
  kind: "STATEMENT" | "CASH";
  bank: string;
  onChoose: (p: MatchPosition | null) => void;
}) {
  const uid = useId(),
    label = kind === "STATEMENT" ? "Statement record" : "Posted cash entry";
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [pending, setPending] = useState(true),
    [error, setError] = useState(""),
    [value, setValue] = useState(""),
    [result, setResult] = useState<{
      items: MatchPosition[];
      page: number;
      pages: number;
      total: number;
    } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      setPending(true);
      setError("");
      fetch(
        "/api/v1/finance/bank-match-options?" +
          new URLSearchParams({
            kind,
            cashAccountId: bank,
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
  }, [kind, bank, q, page, retry]);
  return (
    <fieldset>
      <legend>{label}</legend>
      <label htmlFor={uid + "-search"}>
        Search {label.toLowerCase()}
        <input
          id={uid + "-search"}
          value={q}
          maxLength={100}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
            setPending(true);
            setValue("");
            onChoose(null);
          }}
        />
      </label>
      <label htmlFor={uid + "-value"}>{label}</label>
      <select
        id={uid + "-value"}
        value={value}
        disabled={pending || !!error}
        onChange={(e) => {
          setValue(e.target.value);
          const p = result?.items.find((x) => x.source.id === e.target.value);
          onChoose(p ?? null);
        }}
      >
        <option value="">Choose an available record</option>
        {result?.items.map((p) => (
          <option key={p.source.id} value={p.source.id}>
            {p.source.number ?? p.source.reference} · {p.source.date} ·{" "}
            {p.source.direction} · available {p.remaining} ·{" "}
            {p.source.description}
          </option>
        ))}
      </select>
      <p role="status">
        {pending
          ? "Loading available records…"
          : result
            ? result.total +
              " available · Page " +
              result.page +
              " of " +
              result.pages
            : ""}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button type="button" onClick={() => setRetry((x) => x + 1)}>
            Retry records
          </button>
        </p>
      )}
      <div className="form-actions">
        <button
          type="button"
          disabled={pending || page <= 1}
          onClick={() => {
            setPage((x) => x - 1);
            setValue("");
            setPending(true);
            onChoose(null);
          }}
        >
          Previous {label.toLowerCase()} page
        </button>
        <button
          type="button"
          disabled={pending || !result || page >= result.pages}
          onClick={() => {
            setPage((x) => x + 1);
            setValue("");
            setPending(true);
            onChoose(null);
          }}
        >
          Next {label.toLowerCase()} page
        </button>
      </div>
    </fieldset>
  );
}
type Edge = { statement: MatchPosition; cash: MatchPosition; amount: string };
export function BankMatchForm({ hosted }: { hosted: boolean }) {
  const [bank, setBank] = useState<string | null>(null),
    [statement, setStatement] = useState<MatchPosition | null>(null),
    [cash, setCash] = useState<MatchPosition | null>(null),
    [amount, setAmount] = useState(""),
    [edges, setEdges] = useState<Edge[]>([]),
    [preview, setPreview] = useState<MatchPreview | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const allocations = edges.map((e) => ({
    statementLineId: e.statement.source.id,
    journalLineId: e.cash.source.id,
    amount: e.amount,
  }));
  return (
    <fieldset disabled={pending} className="mutation-fields">
      <legend>Review bank matching</legend>
      <p>
        Choose actual bank records and posted cash entries explicitly. No
        automatic amount/date matching and no ledger posting. Up to 100 distinct
        pairs per reviewed group.
      </p>
      <AccountPicker
        kind="statement-bank"
        label="Bank account"
        value={bank}
        required
        onChange={(v) => {
          setBank(v);
          setStatement(null);
          setCash(null);
          setEdges([]);
          setPreview(null);
          setError("");
        }}
      />
      {bank && (
        <>
          <div className="form-grid">
            <MatchPicker
              key={bank + "s"}
              kind="STATEMENT"
              bank={bank}
              onChoose={setStatement}
            />
            <MatchPicker
              key={bank + "c"}
              kind="CASH"
              bank={bank}
              onChoose={setCash}
            />
          </div>
          {statement && cash && (
            <p>
              Bank {statement.source.date} ({statement.source.direction},
              available {statement.remaining}) ↔ Cash {cash.source.date} (
              {cash.source.direction}, available {cash.remaining}). Each match
              takes the later date.
            </p>
          )}
          <label>
            Allocation amount (PKR)
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              maxLength={21}
              placeholder="0.00"
            />
          </label>
          <button
            type="button"
            disabled={!statement || !cash || edges.length >= 100 || pending}
            onClick={() => {
              setError("");
              if (
                !/^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/.test(amount) ||
                amount === "0.00"
              ) {
                setError(
                  "Use a positive exact amount with two decimal places.",
                );
                return;
              }
              if (
                edges.some(
                  (e) =>
                    e.statement.source.id === statement!.source.id &&
                    e.cash.source.id === cash!.source.id,
                )
              ) {
                setError(
                  "This pair is already listed. Remove it before changing its amount.",
                );
                return;
              }
              setEdges((e) => [
                ...e,
                { statement: statement!, cash: cash!, amount },
              ]);
              setAmount("");
              setPreview(null);
            }}
          >
            Add allocation
          </button>
          <ol>
            {edges.map((e, i) => (
              <li key={i}>
                {e.statement.source.number} record{" "}
                {e.statement.source.description} ↔ {e.cash.source.reference} ·{" "}
                <MoneyCell value={e.amount} />
                <button
                  type="button"
                  aria-label={"Remove allocation " + (i + 1)}
                  disabled={pending}
                  onClick={() => {
                    setEdges(edges.filter((_, n) => n !== i));
                    setPreview(null);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={!edges.length || pending}
            onClick={async () => {
              setPending(true);
              setError("");
              setPreview(null);
              try {
                setPreview(
                  await data(
                    await fetch("/api/v1/finance/bank-matches/preview", {
                      method: "POST",
                      headers: {
                        "content-type": "application/json",
                        "x-encova-csrf": "1",
                      },
                      body: JSON.stringify({
                        cashAccountId: bank,
                        allocations,
                      }),
                    }),
                  ),
                );
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Preview unavailable.",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Checking both sides…" : "Review matching preview"}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <section aria-label="Reviewed matching preview">
              <h2>Matching preview</h2>
              <p>
                Receipts <MoneyCell value={preview.receipts} /> · Payments{" "}
                <MoneyCell value={preview.payments} /> · Effective{" "}
                {preview.earliestDate} — {preview.latestDate}
              </p>
              <p>
                Both statement and cash capacities were checked together. New
                activity requires a new preview.
              </p>
              <ul>
                {preview.allocations.map((a) => (
                  <li key={a.sequence}>
                    Pair {a.sequence}: {a.statement.source.date} bank /{" "}
                    {a.cash.source.date} cash · effective {a.effectiveDate} ·{" "}
                    <MoneyCell value={a.amount} />
                  </li>
                ))}
              </ul>
              <FinanceActionForm
                key={preview.basisHash}
                label="Confirm bank matching"
                endpoint="/api/v1/finance/bank-matches"
                hosted={hosted}
                redirectPrefix="/finance/bank-matches/"
                onReload={() => setPreview(null)}
                business={(f) => ({
                  cashAccountId: bank,
                  allocations,
                  basisHash: preview.basisHash,
                  description: String(f.get("description")),
                  evidence: String(f.get("evidence")),
                  reason: String(f.get("reason")),
                })}
              >
                <label>
                  Description
                  <input
                    name="description"
                    minLength={3}
                    maxLength={1000}
                    required
                  />
                </label>
                <label>
                  Matching evidence
                  <textarea
                    name="evidence"
                    minLength={3}
                    maxLength={1000}
                    required
                  />
                </label>
              </FinanceActionForm>
            </section>
          )}
        </>
      )}
    </fieldset>
  );
}
export function BankUnmatchForm({
  id,
  version,
  hosted,
}: {
  id: string;
  version: number;
  hosted: boolean;
}) {
  return (
    <section className="panel">
      <h2>Undo this matching group</h2>
      <p>
        All its allocations will receive retained opposite events on their
        original effective dates. Their periods must be open. Original cash and
        statement records remain unchanged.
      </p>
      <FinanceActionForm
        label="Confirm unmatch"
        endpoint={"/api/v1/finance/bank-matches/" + id + "/unmatch"}
        hosted={hosted}
        business={(f) => ({
          expectedVersion: version,
          reason: String(f.get("reason")),
        })}
      />
    </section>
  );
}
export function BankSourceLinks({
  source,
}: {
  source: {
    statement: { batchId?: string; number?: string };
    cash: { sourceType?: string; sourceId?: string; reference?: string };
  };
}) {
  const resources: Record<string, string> = {
    MOVEMENT: "movements",
    CUSTOMER_DOCUMENT: "receipts",
    SUPPLIER_DOCUMENT: "supplier-payments",
    BILL: "bills",
    ASSET_MOVEMENT: "asset-movements",
    JOURNAL_DRAFT: "journals",
  };
  const r = source.cash.sourceType ? resources[source.cash.sourceType] : null;
  return (
    <>
      <Link href={"/finance/statements/" + source.statement.batchId}>
        {source.statement.number}
      </Link>{" "}
      ↔{" "}
      {r ? (
        <Link href={"/finance/" + r + "/" + source.cash.sourceId}>
          {source.cash.reference}
        </Link>
      ) : (
        source.cash.reference
      )}
    </>
  );
}
