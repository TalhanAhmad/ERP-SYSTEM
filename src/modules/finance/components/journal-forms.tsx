"use client";
import { useState } from "react";
import type { journalDetail } from "../ledger/service";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import { formatPkr } from "./money-cell";
type Journal = Awaited<ReturnType<typeof journalDetail>>["item"];
export type JournalEditable = Pick<
  Journal,
  "id" | "reference" | "description" | "evidence" | "postingDate" | "version"
> & {
  lines: Pick<
    Journal["lines"][number],
    | "id"
    | "accountId"
    | "description"
    | "debit"
    | "credit"
    | "projectId"
    | "account"
  >[];
};
type DraftLine = {
  key: string;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
  projectId: string | null;
  account?: { code: string; name: string };
};
const newLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  accountId: "",
  description: "",
  debit: "0.00",
  credit: "0.00",
  projectId: null,
});
function preview(lines: DraftLine[]) {
  try {
    const cents = (v: string) => {
      if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?(?![\s\S])/.test(v))
        throw new Error();
      const [n, d = ""] = v.split(".");
      return BigInt(n) * 100n + BigInt(d.padEnd(2, "0"));
    };
    const format = (v: bigint) =>
      (v / 100n).toString() + "." + (v % 100n).toString().padStart(2, "0");
    const d = lines.reduce((v, l) => v + cents(l.debit), 0n),
      c = lines.reduce((v, l) => v + cents(l.credit), 0n);
    if (d > 99999999999999999999n || c > 99999999999999999999n)
      return "Totals exceed the supported PKR range.";
    if (lines.some((l) => cents(l.debit) > 0n === cents(l.credit) > 0n))
      return "Each line needs exactly one positive debit or credit.";
    return (
      formatPkr(format(d)) +
      " debit · " +
      formatPkr(format(c)) +
      " credit · " +
      (d === c && d > 0n && lines.length >= 2 ? "Balanced" : "Not balanced")
    );
  } catch {
    return "Enter valid PKR amounts to preview totals.";
  }
}
export function JournalForm({
  item,
  hosted,
  projects,
  onSaved,
}: {
  item?: JournalEditable;
  onSaved?: () => void;
  hosted: boolean;
  projects: { id: string; name: string }[];
}) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    item ? item.lines.map((l) => ({ ...l, key: l.id })) : [],
  );
  // New forms begin empty on the server; adding lines uses client-generated UI
  // keys only. The database generates every persisted identity.
  const edit = (key: string, patch: Partial<DraftLine>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <FinanceActionForm
      label={item ? "Save draft" : "Create draft"}
      onSaved={onSaved}
      onReload={onSaved}
      endpoint={
        item
          ? "/api/v1/finance/journals/" + item.id
          : "/api/v1/finance/journals"
      }
      method={item ? "PATCH" : "POST"}
      hosted={hosted}
      redirectPrefix={item ? undefined : "/finance/journals/"}
      business={(f) => ({
        reference: String(f.get("reference")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        postingDate: String(f.get("postingDate")),
        currency: "PKR",
        lines: lines.map((l) => ({
          accountId: l.accountId,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          projectId: l.projectId,
        })),
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <div className="form-grid">
        <label>
          Source reference
          <input
            name="reference"
            defaultValue={item?.reference}
            maxLength={80}
            required
          />
        </label>
        <label>
          Posting date
          <input
            name="postingDate"
            type="date"
            defaultValue={item?.postingDate.toISOString().slice(0, 10)}
            required
          />
        </label>
      </div>
      <label>
        Description
        <textarea
          name="description"
          defaultValue={item?.description}
          maxLength={1000}
          required
        />
      </label>
      <label>
        Supporting evidence reference
        <textarea
          name="evidence"
          defaultValue={item?.evidence}
          minLength={3}
          maxLength={1000}
          required
        />
      </label>
      <p>
        PKR only. Manual journals use ordinary adjustment accounts. Cash,
        receivables and other protected controls require their own registers.
      </p>
      {lines.map((l, i) => (
        <fieldset key={l.key} className="panel">
          <legend>Line {i + 1}</legend>
          <AccountPicker
            kind="journal"
            label={"Account for line " + (i + 1)}
            value={l.accountId}
            required
            onChange={(id) => edit(l.key, { accountId: id ?? "" })}
            initial={l.account ? [{ id: l.accountId, ...l.account }] : []}
          />
          <label>
            Line {i + 1} description
            <input
              value={l.description}
              maxLength={500}
              required
              onChange={(e) => edit(l.key, { description: e.target.value })}
            />
          </label>
          <div className="form-grid">
            <label>
              Line {i + 1} debit (PKR)
              <input
                value={l.debit}
                inputMode="decimal"
                required
                onChange={(e) => edit(l.key, { debit: e.target.value })}
              />
            </label>
            <label>
              Line {i + 1} credit (PKR)
              <input
                value={l.credit}
                inputMode="decimal"
                required
                onChange={(e) => edit(l.key, { credit: e.target.value })}
              />
            </label>
          </div>
          <label>
            Project for line {i + 1}
            <select
              value={l.projectId ?? ""}
              onChange={(e) =>
                edit(l.key, { projectId: e.target.value || null })
              }
            >
              <option value="">No project</option>
              {l.projectId && !projects.some((p) => p.id === l.projectId) && (
                <option value={l.projectId}>Current project (retained)</option>
              )}
              {projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
          >
            Remove line {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={lines.length >= 200}
        onClick={() => setLines([...lines, newLine()])}
      >
        Add journal line
      </button>
      <p aria-live="polite">{preview(lines)}</p>
    </FinanceActionForm>
  );
}
export function JournalAction({
  item,
  action,
  hosted,
}: {
  item: Journal;
  action: "POST" | "VOID" | "REVERSE";
  hosted: boolean;
}) {
  const label =
    action === "POST"
      ? "Post journal"
      : action === "VOID"
        ? "Void draft"
        : "Reverse journal";
  return (
    <FinanceActionForm
      label={label}
      endpoint={
        "/api/v1/finance/journals/" + item.id + "/" + action.toLowerCase()
      }
      hosted={hosted}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
        ...(action === "REVERSE"
          ? { postingDate: String(f.get("postingDate")) }
          : {}),
      })}
    >
      {action === "REVERSE" && (
        <label>
          Reversal posting date
          <input
            name="postingDate"
            type="date"
            required
            min={item.postingDate.toISOString().slice(0, 10)}
          />
        </label>
      )}
      <label className="check-label">
        <input type="checkbox" required />I reviewed the lines and posting date.{" "}
        {action === "POST"
          ? "Post immutable journal lines."
          : action === "REVERSE"
            ? "Create dated opposite lines; retain the original."
            : "Withdraw this unposted draft."}
      </label>
    </FinanceActionForm>
  );
}
export function JournalBatchVoid({
  drafts,
  hosted,
}: {
  drafts: { id: string; reference: string; version: number }[];
  hosted: boolean;
}) {
  if (!drafts.length) return null;
  return (
    <details className="panel">
      <summary>Void selected drafts</summary>
      <p>
        Select up to 50 drafts. The whole batch is rejected if any version or
        state changed.
      </p>
      <FinanceActionForm
        label="Void selected drafts"
        endpoint="/api/v1/finance/journals/void-drafts"
        hosted={hosted}
        business={(f) => ({
          items: drafts
            .filter((d) => f.has(d.id))
            .map((d) => ({ id: d.id, expectedVersion: d.version })),
          reason: String(f.get("reason")),
        })}
      >
        {drafts.map((d) => (
          <label className="check-label" key={d.id}>
            <input type="checkbox" name={d.id} />
            {d.reference}
          </label>
        ))}
      </FinanceActionForm>
    </details>
  );
}
