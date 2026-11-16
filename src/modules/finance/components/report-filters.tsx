"use client";
import { useState } from "react";
import { AccountPicker } from "./account-picker";
export function GeneralLedgerFilters({
  from,
  to,
  accountId,
  initial = [],
}: {
  from: string;
  to: string;
  accountId: string | null;
  initial?: { id: string; code: string; name: string }[];
}) {
  const [account, setAccount] = useState(accountId);
  return (
    <form method="get" className="form-grid">
      <label>
        Posting start date
        <input
          type="date"
          name="from"
          min="0001-01-01"
          max="9999-12-31"
          defaultValue={from}
          required
        />
      </label>
      <label>
        Posting end date
        <input
          type="date"
          name="to"
          min="0001-01-01"
          max="9999-12-31"
          defaultValue={to}
          required
        />
      </label>
      <AccountPicker
        kind="report-account"
        label="Ledger account"
        value={account}
        onChange={setAccount}
        initial={initial}
        required
      />
      <input type="hidden" name="accountId" value={account ?? ""} />
      <button type="submit" disabled={!account}>
        Show general ledger
      </button>
    </form>
  );
}
