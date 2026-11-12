"use client";
import { useState } from "react";
import type { masterDetail, masterPeople } from "../masters/service";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import { partyKinds } from "../masters/schemas";
type Detail = Awaited<ReturnType<typeof masterDetail>>;
type Party = Extract<Detail, { resource: "parties" }>["item"];
type Cash = Extract<Detail, { resource: "cash-accounts" }>["item"];
const nullable = (f: FormData, key: string) =>
  String(f.get(key) ?? "").trim() || null;
export function PartyForm({
  item,
  people,
  hosted,
}: {
  item?: Party;
  people: Awaited<ReturnType<typeof masterPeople>>;
  hosted: boolean;
}) {
  const [kind, setKind] = useState(item?.kind ?? "CLIENT"),
    [userId, setUser] = useState(item?.userId ?? "");
  return (
    <FinanceActionForm
      label={item ? "Save party" : "Create party"}
      method={item ? "PATCH" : "POST"}
      endpoint={
        item ? "/api/v1/finance/parties/" + item.id : "/api/v1/finance/parties"
      }
      redirectPrefix={item ? undefined : "/finance/parties/"}
      hosted={hosted}
      business={(f) => ({
        name: String(f.get("name")),
        legalName: String(f.get("legalName")),
        kind,
        contactEmail: nullable(f, "contactEmail"),
        phone: nullable(f, "phone"),
        address: nullable(f, "address"),
        userId: userId || null,
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <label>
        Display name
        <input name="name" defaultValue={item?.name} maxLength={120} required />
      </label>
      <label>
        Legal name
        <input
          name="legalName"
          defaultValue={item?.legalName}
          maxLength={160}
          required
        />
      </label>
      <fieldset className="mutation-fields" disabled={Boolean(item?.usedAt)}>
        <legend>Party classification</legend>
        <label>
          Party kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {partyKinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Existing person (optional)
          <select value={userId} onChange={(e) => setUser(e.target.value)}>
            <option value="">No linked person</option>
            {userId && !people.some((p) => p.id === userId) && (
              <option value={userId}>Current person (retained)</option>
            )}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} · @{p.username}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {item?.usedAt && (
        <p>
          Used party classification is fixed. Correct contact details here;
          posted document snapshots retain their original details.
        </p>
      )}
      <div className="form-grid">
        <label>
          Contact email (optional)
          <input
            type="email"
            name="contactEmail"
            defaultValue={item?.contactEmail ?? ""}
            maxLength={254}
          />
        </label>
        <label>
          Phone (optional)
          <input name="phone" defaultValue={item?.phone ?? ""} maxLength={40} />
        </label>
      </div>
      <label>
        Address (optional)
        <textarea
          name="address"
          defaultValue={item?.address ?? ""}
          maxLength={1000}
        />
      </label>
    </FinanceActionForm>
  );
}
export function CashForm({ item, hosted }: { item?: Cash; hosted: boolean }) {
  const [gl, setGl] = useState(item?.glAccountId ?? ""),
    [kind, setKind] = useState(item?.kind ?? "BANK");
  return (
    <FinanceActionForm
      label={item ? "Save cash account" : "Create cash account"}
      method={item ? "PATCH" : "POST"}
      endpoint={
        item
          ? "/api/v1/finance/cash-accounts/" + item.id
          : "/api/v1/finance/cash-accounts"
      }
      redirectPrefix={item ? undefined : "/finance/cash-accounts/"}
      hosted={hosted}
      business={(f) => ({
        name: String(f.get("name")),
        kind,
        glAccountId: gl,
        currency: "PKR",
        maskedReference: item?.mappingLocked
          ? item.maskedReference
          : nullable(f, "maskedReference"),
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <label>
        Cash account name
        <input name="name" defaultValue={item?.name} required maxLength={120} />
      </label>
      <fieldset
        className="mutation-fields"
        disabled={Boolean(item?.mappingLocked)}
      >
        <legend>Cash mapping</legend>
        <label>
          Cash account kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option>BANK</option>
            <option>CASH</option>
          </select>
        </label>
        <AccountPicker
          kind="cash"
          label="Cash GL account"
          required
          value={gl}
          onChange={(id) => setGl(id ?? "")}
          initial={item ? [item.glAccount] : []}
        />
        <label>
          Last four digits (optional)
          <input
            name="maskedReference"
            defaultValue={item?.maskedReference ?? ""}
            inputMode="numeric"
            pattern="[0-9]{4}"
            minLength={4}
            maxLength={4}
          />
        </label>
      </fieldset>
      <p>
        PKR only. Store the last four digits, never the full bank number. The GL
        account must be a noncontra CASH posting account. Balances will derive
        from posted movements.
      </p>
      {item?.mappingLocked && (
        <p>
          This mapping has been used and is fixed. Its display name can be
          corrected.
        </p>
      )}
    </FinanceActionForm>
  );
}
export function MasterStateForm({
  id,
  version,
  active,
  resource,
  hosted,
}: {
  id: string;
  version: number;
  active: boolean;
  resource: "parties" | "cash-accounts";
  hosted: boolean;
}) {
  const label =
    (active ? "Archive " : "Reactivate ") +
    (resource === "parties" ? "party" : "cash account");
  return (
    <FinanceActionForm
      label={label}
      endpoint={
        "/api/v1/finance/" +
        resource +
        "/" +
        id +
        "/" +
        (active ? "archive" : "reactivate")
      }
      hosted={hosted}
      business={(f) => ({
        expectedVersion: version,
        reason: String(f.get("reason")),
      })}
    />
  );
}
