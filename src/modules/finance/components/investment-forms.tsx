"use client";
import { useState } from "react";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import type { holdingDetail } from "../investments/service";
import type { movementDetail } from "../treasury/service";
type Holding = Awaited<ReturnType<typeof holdingDetail>>["item"];
type Movement = Awaited<ReturnType<typeof movementDetail>>["item"];
const maps = [
  {
    field: "investmentAccountId",
    relation: "investmentAccount",
    label: "Investment control account",
    kind: "investment",
  },
  {
    field: "gainAccountId",
    relation: "gainAccount",
    label: "Disposal gain account",
    kind: "revenue",
    type: "OTHER_INCOME",
  },
  {
    field: "lossAccountId",
    relation: "lossAccount",
    label: "Disposal loss account",
    kind: "fee",
    type: "OTHER_EXPENSE",
  },
  {
    field: "feeAccountId",
    relation: "feeAccount",
    label: "Investment fee account",
    kind: "fee",
  },
  {
    field: "incomeAccountId",
    relation: "incomeAccount",
    label: "Investment income account",
    kind: "revenue",
    type: "OTHER_INCOME",
  },
  {
    field: "incomeControlAccountId",
    relation: "incomeControlAccount",
    label: "Investment income receivable",
    kind: "investment-income-receivable",
  },
  {
    field: "impairmentAccountId",
    relation: "impairmentAccount",
    label: "Impairment expense account",
    kind: "fee",
    type: "OTHER_EXPENSE",
  },
  {
    field: "valuationOffsetAccountId",
    relation: "valuationOffsetAccount",
    label: "Reviewed valuation offset",
    kind: "journal",
  },
] as const;
type MapKey = (typeof maps)[number]["field"];
export function HoldingForm({
  item,
  hosted,
}: {
  item?: Holding;
  hosted: boolean;
}) {
  const [party, setParty] = useState(item?.partyId ?? null),
    [classification, setClassification] = useState(
      item?.classification ?? "CURRENT",
    ),
    [status, setStatus] = useState(item?.policyStatus ?? "PENDING"),
    [measurement, setMeasurement] = useState(item?.measurementMode ?? "COST"),
    [treatment, setTreatment] = useState(
      item?.valuationTreatment ?? "PROFIT_LOSS",
    ),
    [accounts, setAccounts] = useState(
      Object.fromEntries(
        maps.map((m) => [m.field, item?.[m.field] ?? null]),
      ) as Record<MapKey, string | null>,
    );
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save holding policy" : "Create investment holding"}
      endpoint={"/api/v1/finance/holdings" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/investments/"}
      business={(f) => ({
        name: String(f.get("name")),
        partyId: party,
        investmentType: String(f.get("investmentType")),
        unitMode: String(f.get("unitMode")),
        classification,
        policyStatus: status,
        measurementMode: measurement,
        valuationTreatment: treatment,
        policy: String(f.get("policy")),
        evidence: String(f.get("evidence")),
        ...accounts,
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <div className="form-grid">
        <label>
          Holding name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={item?.name}
          />
        </label>
        <label>
          Investment type
          <input
            name="investmentType"
            required
            maxLength={60}
            defaultValue={item?.investmentType}
          />
        </label>
        <label>
          Unit tracking
          <select name="unitMode" defaultValue={item?.unitMode ?? "UNIT"}>
            <option value="UNIT">Units or shares</option>
            <option value="AMOUNT">Amount based</option>
          </select>
        </label>
        <label>
          Classification
          <select
            value={classification}
            onChange={(e) => {
              setClassification(e.target.value);
              setAccounts({ ...accounts, investmentAccountId: null });
            }}
          >
            <option value="CURRENT">Current asset</option>
            <option value="NONCURRENT">Noncurrent asset</option>
          </select>
        </label>
      </div>
      <AccountPicker
        kind="contributor"
        label="Issuer or counterparty"
        value={party}
        onChange={setParty}
        required
        initial={
          item && party ? [{ id: party, code: "", name: item.party.name }] : []
        }
      />
      <label>
        Policy review status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="PENDING">Pending review / unsupported policy</option>
          <option value="REVIEWED">Reviewed supported policy</option>
        </select>
      </label>
      <label>
        Measurement approach
        <select
          value={measurement}
          onChange={(e) => setMeasurement(e.target.value)}
        >
          <option value="COST">Reviewed cost with manual impairment</option>
          <option value="MANUAL_VALUATION">
            Reviewed manual valuation adjustments
          </option>
        </select>
      </label>
      <label>
        Valuation offset treatment
        <select
          value={treatment}
          onChange={(e) => {
            setTreatment(e.target.value);
            setAccounts({ ...accounts, valuationOffsetAccountId: null });
          }}
        >
          <option value="PROFIT_LOSS">Reviewed profit/loss offset</option>
          <option value="EQUITY">Reviewed equity offset</option>
        </select>
      </label>
      <label>
        Reviewed measurement and income policy
        <textarea
          name="policy"
          required
          minLength={3}
          maxLength={2000}
          defaultValue={item?.policy}
        />
      </label>
      <label>
        Policy evidence reference
        <textarea
          name="evidence"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={item?.evidence}
        />
      </label>
      {maps.map((m) => {
        const a = item?.[m.relation],
          value = accounts[m.field],
          type =
            m.field === "valuationOffsetAccountId"
              ? treatment === "EQUITY"
                ? "EQUITY"
                : "OTHER_INCOME"
              : "type" in m
                ? m.type
                : undefined;
        return (
          <AccountPicker
            key={
              m.field +
              (m.field === "investmentAccountId"
                ? classification
                : (type ?? ""))
            }
            kind={m.kind}
            label={m.label}
            type={type}
            group={
              m.field === "investmentAccountId"
                ? classification === "CURRENT"
                  ? "CURRENT_ASSETS"
                  : "NONCURRENT_ASSETS"
                : undefined
            }
            value={value}
            onChange={(v) => setAccounts({ ...accounts, [m.field]: v })}
            required={
              m.field === "investmentAccountId" ||
              (status === "REVIEWED" &&
                (m.field !== "valuationOffsetAccountId" ||
                  measurement === "MANUAL_VALUATION"))
            }
            initial={
              a && value ? [{ id: value, code: a.code, name: a.name }] : []
            }
          />
        );
      })}
      <p>
        Pending policies cannot post. Reviewed mappings freeze after first use.
        Values come from reviewed entries; no market prices, ownership advice or
        compliance status are inferred.
      </p>
    </FinanceActionForm>
  );
}
export function InvestmentAcquisitionForm({
  holding,
  item,
  hosted,
}: {
  holding: Pick<Holding, "id" | "name" | "unitMode">;
  item?: Movement;
  hosted: boolean;
}) {
  const [bank, setBank] = useState(item?.fromCashId ?? null);
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save acquisition draft" : "Create acquisition draft"}
      endpoint={"/api/v1/finance/movements" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/movements/"}
      business={(f) => ({
        kind: "INVESTMENT_ACQUISITION",
        holdingId: holding.id,
        units: holding.unitMode === "UNIT" ? String(f.get("units")) : null,
        fromCashId: bank,
        amount: String(f.get("amount")),
        reference: String(f.get("reference")),
        documentDate: String(f.get("documentDate")),
        postingDate: String(f.get("postingDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        currency: "PKR",
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <p>
        {holding.name} · {holding.unitMode}
      </p>
      <AccountPicker
        kind="cash-account"
        label="Paying bank or cash"
        value={bank}
        onChange={setBank}
        required
        initial={
          item?.fromCash && bank
            ? [{ id: bank, code: "", name: item.fromCash.name }]
            : []
        }
      />
      <div className="form-grid">
        <label>
          Acquisition cost (PKR)
          <input
            name="amount"
            required
            inputMode="decimal"
            defaultValue={item?.amount}
          />
        </label>
        {holding.unitMode === "UNIT" && (
          <label>
            Units acquired
            <input
              name="units"
              required
              inputMode="decimal"
              defaultValue={item?.units ?? ""}
            />
          </label>
        )}
        <label>
          External reference
          <input
            name="reference"
            required
            maxLength={80}
            defaultValue={item?.reference}
          />
        </label>
        <label>
          Document date
          <input
            name="documentDate"
            type="date"
            required
            defaultValue={item?.documentDate}
          />
        </label>
        <label>
          Posting date
          <input
            name="postingDate"
            type="date"
            required
            defaultValue={item?.postingDate}
          />
        </label>
      </div>
      <label>
        Movement description
        <textarea
          name="description"
          required
          maxLength={1000}
          defaultValue={item?.description}
        />
      </label>
      <label>
        Supporting evidence reference
        <textarea
          name="evidence"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={item?.evidence}
        />
      </label>
      <p>
        Each posted purchase creates a separate original-cost lot and the
        matching investment debit/cash credit. This records an acquisition; it
        does not execute a trade.
      </p>
    </FinanceActionForm>
  );
}
export function HoldingArchiveForm({
  item,
  hosted,
}: {
  item: Holding;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item.active ? "Archive empty holding" : "Reactivate holding"}
      endpoint={
        "/api/v1/finance/holdings/" +
        item.id +
        (item.active ? "/archive" : "/reactivate")
      }
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    >
      <p>Archival retains all source history and requires cleared balances.</p>
    </FinanceActionForm>
  );
}
