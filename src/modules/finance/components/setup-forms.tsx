"use client";
import { useState } from "react";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import {
  accountTypes,
  normalSides,
  groupsByType,
  controlTypes,
  debitTypes,
} from "../accounting/catalog";
import type {
  accountDetail,
  accounts,
  periodDetail,
} from "../accounting/service";
type Account = Awaited<ReturnType<typeof accountDetail>>["item"];
type Groups = Awaited<ReturnType<typeof accounts>>["groups"];
const defaults = {
  code: "",
  name: "",
  type: "ASSET",
  normalSide: "DEBIT",
  reportGroup: "CURRENT_ASSETS",
  controlType: "NONE",
  currency: "PKR",
  parentId: null,
  isPosting: true,
  isContra: false,
  isCashEquivalent: false,
};
export function AccountForm({
  item,
  groups,
  hosted,
}: {
  item?: Account;
  groups: Groups;
  hosted: boolean;
}) {
  const [draft, setDraft] = useState<Pick<Account, keyof typeof defaults>>(
    item ? { ...item } : { ...defaults },
  );
  const mappingLocked = Boolean(item?.mappingLocked);
  const field = (name: string) =>
    String(draft[name as keyof typeof draft] ?? "");
  const compatible = groups.filter(
    (g) => g.type === draft.type && g.reportGroup === draft.reportGroup,
  );
  return (
    <FinanceActionForm
      label={item ? "Save account" : "Create account"}
      method={item ? "PATCH" : "POST"}
      endpoint={
        item
          ? `/api/v1/finance/accounts/${item.id}`
          : "/api/v1/finance/accounts"
      }
      hosted={hosted}
      redirectPrefix={item ? undefined : "/finance/accounts/"}
      business={(f) => ({
        code: draft.code,
        name: String(f.get("name")),
        type: draft.type,
        normalSide: draft.normalSide,
        reportGroup: draft.reportGroup,
        controlType: draft.controlType,
        currency: "PKR",
        parentId: draft.parentId,
        isPosting: draft.isPosting,
        isContra: draft.isContra,
        isCashEquivalent: draft.isCashEquivalent,
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <label>
        Account name
        <input
          name="name"
          defaultValue={field("name")}
          maxLength={120}
          required
        />
      </label>
      {mappingLocked && (
        <p className="muted">
          This account or a descendant has been used. Its mapping is fixed; the
          name and archive state can still be managed.
        </p>
      )}
      <fieldset
        disabled={mappingLocked}
        className="mutation-fields"
        aria-label="Account mapping"
      >
        <div className="form-grid">
          <label>
            Account code
            <input
              name="code"
              value={draft.code}
              onChange={(e) =>
                setDraft({ ...draft, code: e.target.value.toUpperCase() })
              }
              pattern={"[A-Z0-9][A-Z0-9._\\-]{1,19}"}
              minLength={2}
              maxLength={20}
              required
            />
          </label>
          <label>
            Account type
            <select
              name="type"
              value={draft.type}
              onChange={(e) => {
                const type = e.target.value as (typeof accountTypes)[number];
                setDraft({
                  ...draft,
                  type,
                  reportGroup: groupsByType[type][0],
                  normalSide: debitTypes.includes(type) ? "DEBIT" : "CREDIT",
                  controlType: "NONE",
                  isContra: false,
                  isCashEquivalent: false,
                  parentId: null,
                });
              }}
            >
              {accountTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Report group
            <select
              name="reportGroup"
              value={draft.reportGroup}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  reportGroup: e.target.value,
                  parentId: null,
                })
              }
            >
              {groupsByType[draft.type as (typeof accountTypes)[number]].map(
                (g) => (
                  <option key={g}>{g}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Control register
            <select
              name="controlType"
              value={draft.controlType}
              onChange={(e) => {
                const control = e.target.value,
                  contra = control === "ACCUMULATED_DEPRECIATION";
                setDraft({
                  ...draft,
                  controlType: control,
                  isContra: contra,
                  normalSide:
                    debitTypes.includes(draft.type) !== contra
                      ? "DEBIT"
                      : "CREDIT",
                  isCashEquivalent: false,
                });
              }}
            >
              {controlTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Normal balance side
            <select
              name="normalSide"
              value={draft.normalSide}
              onChange={(e) =>
                setDraft({ ...draft, normalSide: e.target.value })
              }
            >
              {normalSides.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <AccountPicker
            kind="parent"
            label="Parent group"
            value={draft.parentId}
            type={draft.type}
            group={draft.reportGroup}
            exclude={item?.id}
            initial={compatible}
            onChange={(id) => setDraft({ ...draft, parentId: id })}
          />
        </div>
        <label className="check-label">
          <input
            name="isPosting"
            type="checkbox"
            checked={draft.isPosting}
            onChange={(e) =>
              setDraft({
                ...draft,
                isPosting: e.target.checked,
                controlType: "NONE",
                isContra: false,
                isCashEquivalent: false,
                normalSide: debitTypes.includes(draft.type)
                  ? "DEBIT"
                  : "CREDIT",
              })
            }
          />
          Posting account (untick for a group)
        </label>
        <label className="check-label">
          <input
            name="isContra"
            type="checkbox"
            checked={draft.isContra}
            onChange={(e) =>
              setDraft({
                ...draft,
                isContra: e.target.checked,
                normalSide:
                  debitTypes.includes(draft.type) !== e.target.checked
                    ? "DEBIT"
                    : "CREDIT",
              })
            }
          />
          Contra account
        </label>
        <label className="check-label">
          <input
            name="isCashEquivalent"
            type="checkbox"
            checked={draft.isCashEquivalent}
            onChange={(e) =>
              setDraft({ ...draft, isCashEquivalent: e.target.checked })
            }
          />
          Cash-equivalent account (posting cash controls only)
        </label>
      </fieldset>
      <p className="muted">
        Currency: PKR. Control accounts require their corresponding registers
        when posting. No opening balance is entered here.
      </p>
    </FinanceActionForm>
  );
}
export function AccountArchive({
  item,
  hosted,
}: {
  item: Account;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      label={item.active ? "Archive account" : "Reactivate account"}
      endpoint={`/api/v1/finance/accounts/${item.id}/${item.active ? "archive" : "reactivate"}`}
      hosted={hosted}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    />
  );
}
type Period = Awaited<ReturnType<typeof periodDetail>>["item"];
export function PeriodForm({
  item,
  hosted,
}: {
  item?: Period;
  hosted: boolean;
}) {
  const start = item?.startDate.toISOString().slice(0, 10) ?? "",
    end = item?.endDate.toISOString().slice(0, 10) ?? "";
  return (
    <FinanceActionForm
      label={item ? "Save period" : "Create open period"}
      endpoint={
        item ? `/api/v1/finance/periods/${item.id}` : "/api/v1/finance/periods"
      }
      method={item ? "PATCH" : "POST"}
      hosted={hosted}
      redirectPrefix={item ? undefined : "/finance/periods/"}
      business={(f) => ({
        name: String(f.get("name")),
        startDate: item?.usedAt ? start : String(f.get("startDate")),
        endDate: item?.usedAt ? end : String(f.get("endDate")),
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <label>
        Period name
        <input
          name="name"
          maxLength={120}
          required
          defaultValue={item?.name ?? ""}
        />
      </label>
      <div className="form-grid">
        <label>
          Start date (inclusive)
          <input
            name="startDate"
            type="date"
            required
            defaultValue={start}
            readOnly={Boolean(item?.usedAt)}
          />
        </label>
        <label>
          End date (inclusive)
          <input
            name="endDate"
            type="date"
            required
            defaultValue={end}
            readOnly={Boolean(item?.usedAt)}
          />
        </label>
      </div>
      <p className="muted">
        Choose the actual reporting dates. No fiscal year, company policy or
        opening balances are assumed.
      </p>
    </FinanceActionForm>
  );
}
export function PeriodVoid({
  item,
  hosted,
}: {
  item: Period;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      label="Void unused period"
      endpoint={`/api/v1/finance/periods/${item.id}/void`}
      hosted={hosted}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    />
  );
}
