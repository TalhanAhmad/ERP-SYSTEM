"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import type { StatementSettings } from "../reports/statements/service";
export function StatementPolicyForm({
  hosted,
  policy,
}: {
  hosted: boolean;
  policy: StatementSettings["policy"];
}) {
  const evidenceId = useId();
  return (
    <FinanceActionForm
      label="Save statement presentation"
      endpoint="/api/v1/finance/statement-settings/policy"
      hosted={hosted}
      business={(f) => ({
        overdraftPresentation: String(f.get("overdraftPresentation")),
        evidence: String(f.get("evidence")),
        expectedVersion: policy?.version ?? null,
        reason: String(f.get("reason")),
      })}
    >
      <label htmlFor="statement-overdraft">
        Bank credit balance presentation
      </label>
      <select
        id="statement-overdraft"
        name="overdraftPresentation"
        defaultValue={policy?.overdraftPresentation ?? "UNREVIEWED"}
      >
        <option value="UNREVIEWED">
          Unreviewed — affected statements remain provisional
        </option>
        <option value="CURRENT_LIABILITY">
          Reviewed — present as current liabilities
        </option>
      </select>
      <p>
        Record the company’s reviewed presentation choice. This changes report
        presentation and does not post or change ledger amounts.
      </p>
      <label htmlFor={evidenceId}>Presentation evidence</label>
      <textarea
        id={evidenceId}
        name="evidence"
        minLength={3}
        maxLength={1000}
        required
        defaultValue={policy?.evidence ?? ""}
      />
    </FinanceActionForm>
  );
}
type CurrentMapping = {
  id: string;
  accountId: string;
  active: boolean;
  evidence: string;
  version: number;
};
export function StatementTaxMappingForm({
  hosted,
  initialAccount,
}: {
  hosted: boolean;
  initialAccount?: { id: string; code: string; name: string };
}) {
  const evidenceId = useId();
  const [account, setAccount] = useState<string | null>(
      initialAccount?.id ?? null,
    ),
    [mapping, setMapping] = useState<CurrentMapping | null>(null),
    [evidence, setEvidence] = useState(""),
    [active, setActive] = useState(true),
    [pending, setPending] = useState(!!initialAccount),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const currentAccount = useRef(account);
  useEffect(() => {
    if (!account) return;
    const c = new AbortController(),
      t = setTimeout(() => {
        setPending(true);
        setError("");
        fetch(
          "/api/v1/finance/accounts/" + account + "/statement-tax-mapping",
          { cache: "no-store", signal: c.signal },
        )
          .then(async (r) => {
            const b = await r.json();
            if (!r.ok) throw new Error(b.error.message);
            return b.data.item as CurrentMapping | null;
          })
          .then((m) => {
            setMapping(m);
            setEvidence(m?.evidence ?? "");
            setActive(m?.active ?? true);
            setPending(false);
          })
          .catch((e) => {
            if (!c.signal.aborted && currentAccount.current === account) {
              setError(e.message);
              setPending(false);
            }
          });
      }, 100);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [account, retry]);
  return (
    <FinanceActionForm
      label="Save income-tax presentation"
      endpoint="/api/v1/finance/statement-settings/tax-mappings"
      hosted={hosted}
      submitDisabled={!account || pending || !!error}
      onSaved={() => {
        setPending(true);
        setRetry((n) => n + 1);
      }}
      business={(f) => ({
        accountId: account,
        active,
        evidence,
        expectedVersion: mapping?.version ?? null,
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Classify an ordinary operating/other expense already recorded for income
        tax. VAT and withholding controls remain separate. The actual expense is
        counted once.
      </p>
      <AccountPicker
        kind="statement-tax-account"
        label="Income-tax expense account"
        value={account}
        required
        initial={initialAccount ? [initialAccount] : []}
        onChange={(id) => {
          currentAccount.current = id;
          setAccount(id);
          setMapping(null);
          setEvidence("");
          setActive(true);
          setError("");
          setPending(!!id);
        }}
      />
      <p role="status">
        {pending
          ? "Loading current presentation…"
          : mapping
            ? "Current mapping version " + mapping.version
            : account
              ? "No existing mapping; this will create its first reviewed version."
              : "Choose an eligible expense account."}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
          <button
            type="button"
            onClick={() => {
              setPending(true);
              setRetry((n) => n + 1);
            }}
          >
            Retry current mapping
          </button>
        </p>
      )}
      <label>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          disabled={pending}
        />
        Present this account as income-tax expense
      </label>
      <label htmlFor={evidenceId}>Income-tax presentation evidence</label>
      <textarea
        id={evidenceId}
        minLength={3}
        maxLength={1000}
        required
        value={evidence}
        disabled={pending}
        onChange={(e) => setEvidence(e.target.value)}
      />
    </FinanceActionForm>
  );
}
