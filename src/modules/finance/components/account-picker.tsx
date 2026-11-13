"use client";
import { useEffect, useId, useState } from "react";
type Option = { id: string; code: string; name: string };
export function AccountPicker({
  kind,
  label,
  value,
  onChange,
  type,
  group,
  exclude,
  partyId,
  invoiceId,
  billId,
  initial = [],
  required = false,
}: {
  kind:
    | "payable"
    | "cost"
    | "prepayment"
    | "fixed-asset"
    | "tax-code"
    | "withholding-code"
    | "tax-input"
    | "tax-output"
    | "withholding-receivable"
    | "withholding-payable"
    | "supplier"
    | "supplier-advance"
    | "bill"
    | "credit-bill"
    | "bill-line"
    | "supplier-advance-source"
    | "parent"
    | "journal"
    | "cash"
    | "receivable"
    | "revenue"
    | "deferred"
    | "party"
    | "project"
    | "invoice"
    | "cash-account"
    | "fee"
    | "advance"
    | "advance-source"
    | "credit-invoice"
    | "invoice-line";
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  type?: string;
  group?: string;
  exclude?: string;
  partyId?: string;
  invoiceId?: string;
  billId?: string;
  initial?: Option[];
  required?: boolean;
}) {
  const id = useId(),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    items: Option[];
    total: number;
    page: number;
    pages: number;
  }>({ items: initial, total: initial.length, page: 1, pages: 1 });
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      if (
        ([
          "invoice",
          "advance-source",
          "credit-invoice",
          "bill",
          "credit-bill",
          "supplier-advance-source",
        ].includes(kind) &&
          !partyId) ||
        (kind === "invoice-line" && !invoiceId) ||
        (kind === "bill-line" && !billId)
      ) {
        setResult({ items: [], total: 0, page: 1, pages: 1 });
        setError("");
        setPending(false);
        return;
      }
      setPending(true);
      setError("");
      try {
        const query = new URLSearchParams({
          kind:
            kind === "tax-code"
              ? "INDIRECT"
              : kind === "withholding-code"
                ? "WITHHOLDING"
                : kind,
          q,
          page: String(page),
          ...(type ? { type } : {}),
          ...(group ? { group } : {}),
          ...(exclude ? { exclude } : {}),
          ...(partyId ? { partyId } : {}),
          ...(invoiceId ? { invoiceId } : {}),
          ...(billId ? { billId } : {}),
        });
        const response = await fetch(
          "/api/v1/finance/" +
            (["tax-code", "withholding-code"].includes(kind)
              ? "tax-codes?"
              : [
                    "bill",
                    "credit-bill",
                    "bill-line",
                    "supplier-advance-source",
                  ].includes(kind)
                ? "supplier-options?"
                : [
                      "party",
                      "supplier",
                      "project",
                      "invoice",
                      "cash-account",
                      "advance-source",
                      "credit-invoice",
                      "invoice-line",
                    ].includes(kind)
                  ? "invoice-options?"
                  : "account-options?") +
            query,
          { signal: abort.signal, cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error.message);
        if (["tax-code", "withholding-code"].includes(kind))
          body.data.items = body.data.items.map(
            (i: {
              id: string;
              code: string;
              name: string;
              rate: string;
              effectiveFrom: string;
              effectiveTo: string | null;
              mode: string;
            }) => ({
              ...i,
              name:
                i.name +
                " · " +
                i.rate +
                "% · " +
                i.mode +
                " · " +
                i.effectiveFrom +
                " to " +
                (i.effectiveTo ?? "open end"),
            }),
          );
        setResult(body.data);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load choices.");
      } finally {
        if (!abort.signal.aborted) setPending(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [billId, kind, q, page, type, group, exclude, partyId, invoiceId, retry]);
  const selected =
    result.items.find((i) => i.id === value) ??
    initial.find((i) => i.id === value);
  return (
    <div className="account-picker">
      <label htmlFor={id + "-search"}>
        Search {label.toLowerCase()}
        <input
          id={id + "-search"}
          value={q}
          maxLength={100}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          autoComplete="off"
        />
      </label>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        required={required}
        aria-busy={pending}
      >
        <option value="">{required ? "Choose an account" : "None"}</option>
        {value && !result.items.some((i) => i.id === value) && (
          <option value={value}>
            {selected
              ? selected.code + " · " + selected.name
              : "Current selection (retained)"}
          </option>
        )}
        {result.items.map((i) => (
          <option key={i.id} value={i.id}>
            {[i.code, i.name].filter(Boolean).join(" · ")}
          </option>
        ))}
      </select>
      <p className="muted" aria-live="polite">
        {pending
          ? "Searching…"
          : result.total +
            " matching choices · page " +
            result.page +
            " of " +
            result.pages}
      </p>
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRetry((x) => x + 1)}>
            Retry search
          </button>
        </p>
      )}
      <div className="form-actions">
        {result.page > 1 && (
          <button type="button" onClick={() => setPage(result.page - 1)}>
            Previous matches
          </button>
        )}
        {result.page < result.pages && (
          <button type="button" onClick={() => setPage(result.page + 1)}>
            Next matches
          </button>
        )}
      </div>
    </div>
  );
}
