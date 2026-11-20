"use client";
import { useEffect, useId, useState } from "react";
type Option = {
  id: string;
  tag?: string;
  number?: string;
  reference?: string;
  description: string;
  balance?: string;
};
export function AutomationPicker({
  kind,
  label,
  asOf,
  value,
  onChange,
}: {
  kind: "ASSET" | "DEFERRED" | "EQUITY";
  label: string;
  asOf?: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const id = useId(),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [data, setData] = useState<{
      items: Option[];
      page: number;
      pages: number;
      total: number;
    }>({ items: [], page: 1, pages: 1, total: 0 });
  useEffect(() => {
    const abort = new AbortController(),
      timer = setTimeout(async () => {
        if (kind === "DEFERRED" && !asOf) {
          setData({ items: [], page: 1, pages: 1, total: 0 });
          return;
        }
        setPending(true);
        setError("");
        try {
          const q = new URLSearchParams({
              kind,
              q: query,
              page: String(page),
              ...(asOf ? { asOf } : {}),
            }),
            r = await fetch("/api/v1/finance/automation/options?" + q, {
              signal: abort.signal,
            }),
            j = await r.json();
          if (!r.ok) throw Error(j.error.message);
          setData(j.data);
        } catch (e) {
          if (!abort.signal.aborted) {
            setData({ items: [], page: 1, pages: 1, total: 0 });
            setError(e instanceof Error ? e.message : "Choices unavailable.");
          }
        } finally {
          if (!abort.signal.aborted) setPending(false);
        }
      }, 200);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [kind, asOf, query, page, retry]);
  return (
    <div>
      <label htmlFor={id + "-search"}>Search {label.toLowerCase()}</label>
      <input
        id={id + "-search"}
        type="search"
        value={query}
        maxLength={100}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ""}
        required
        disabled={pending || (kind === "DEFERRED" && !asOf)}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Choose {label.toLowerCase()}</option>
        {data.items.map((x) => (
          <option key={x.id} value={x.id}>
            {x.tag ?? x.number} · {x.reference ?? x.description}
            {x.balance ? " · PKR " + x.balance : ""}
          </option>
        ))}
      </select>
      {pending && <p role="status">Loading choices…</p>}
      {error && (
        <div role="alert">
          {error}
          <button type="button" onClick={() => setRetry((v) => v + 1)}>
            Retry choices
          </button>
        </div>
      )}
      <p>
        {data.total} choices · Page {data.page} of {data.pages}
      </p>
      <button
        type="button"
        disabled={pending || data.page <= 1}
        onClick={() => setPage(data.page - 1)}
      >
        Previous choices
      </button>
      <button
        type="button"
        disabled={pending || data.page >= data.pages}
        onClick={() => setPage(data.page + 1)}
      >
        Next choices
      </button>
    </div>
  );
}
