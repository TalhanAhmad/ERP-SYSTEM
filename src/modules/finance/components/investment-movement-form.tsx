"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import { investmentKinds } from "../treasury/kinds";
import type { holdingDetail } from "../investments/service";
import type { movementDetail } from "../treasury/service";
type Holding = Awaited<ReturnType<typeof holdingDetail>>["item"];
type Movement = Awaited<ReturnType<typeof movementDetail>>["item"];
const canonical = (v: string) => {
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/.test(v)) return null;
  const [a, b = ""] = v.split(".");
  return a + "." + b.padEnd(2, "0");
};
export function InvestmentMovementForm({
  holding,
  item,
  hosted,
}: {
  holding: Pick<Holding, "id" | "name" | "unitMode">;
  item?: Movement;
  hosted: boolean;
}) {
  const [kind, setKind] = useState(item?.kind ?? "INVESTMENT_DISPOSAL"),
    [amount, setAmount] = useState(item?.amount ?? ""),
    [fee, setFee] = useState(item?.feeAmount ?? "0.00"),
    [bank, setBank] = useState(item?.toCashId ?? null),
    [rows, setRows] = useState(
      item?.investmentAllocations.map((a) => ({
        key: a.id,
        lotId: a.lotId as string | null,
        disposeAll: a.disposeAll,
        units: a.requestedUnits ?? "",
        carryingAmount: a.requestedCarrying ?? "",
        name: a.lot.movement.number,
      })) ?? [],
    );
  const disposal = kind === "INVESTMENT_DISPOSAL",
    adjustment = [
      "INVESTMENT_IMPAIRMENT",
      "INVESTMENT_VALUATION_UP",
      "INVESTMENT_VALUATION_DOWN",
    ].includes(kind),
    cash =
      ["INVESTMENT_INCOME_RECEIPT", "INVESTMENT_INCOME_SETTLEMENT"].includes(
        kind,
      ) ||
      (disposal && canonical(amount) !== canonical(fee));
  const sums = rows.reduce((n, r) => {
      const c = canonical(r.carryingAmount);
      return c === null ? n : n + BigInt(c.replace(".", ""));
    }, 0n),
    total =
      (sums / 100n).toString() +
      "." +
      (sums % 100n).toString().padStart(2, "0");
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save investment draft" : "Create investment movement"}
      endpoint={"/api/v1/finance/movements" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/movements/"}
      business={(f) => ({
        kind,
        holdingId: holding.id,
        amount,
        feeAmount: disposal ? fee : "0.00",
        toCashId: cash ? bank : null,
        allocations:
          disposal || adjustment
            ? rows.map((r) => ({
                lotId: r.lotId,
                disposeAll: disposal && r.disposeAll,
                units:
                  disposal && holding.unitMode === "UNIT" && !r.disposeAll
                    ? r.units
                    : null,
                carryingAmount:
                  adjustment ||
                  (disposal && holding.unitMode === "AMOUNT" && !r.disposeAll)
                    ? r.carryingAmount
                    : null,
              }))
            : [],
        approvalEvidence: adjustment ? String(f.get("approvalEvidence")) : null,
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
      <label>
        Investment movement classification
        <select
          value={kind}
          disabled={!!item}
          onChange={(e) => {
            setKind(e.target.value);
            setRows([]);
          }}
        >
          {investmentKinds
            .filter((k) => k !== "INVESTMENT_ACQUISITION")
            .map((k) => (
              <option key={k} value={k}>
                {k.replaceAll("_", " ")}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          {disposal
            ? "Gross disposal proceeds (PKR)"
            : adjustment
              ? "Reviewed value change (PKR)"
              : "Income amount (PKR)"}
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            inputMode="decimal"
          />
        </label>
        {disposal && (
          <label>
            Disposal fees (PKR)
            <input
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              required
              inputMode="decimal"
            />
          </label>
        )}
      </div>
      {cash && (
        <AccountPicker
          kind="cash-account"
          label="Settlement bank or cash"
          value={bank}
          onChange={setBank}
          required
          initial={
            item?.toCash && bank
              ? [{ id: bank, code: "", name: item.toCash.name }]
              : []
          }
        />
      )}
      {(disposal || adjustment) && (
        <fieldset>
          <legend>Explicit lots</legend>
          <p>
            Use a date on or after each selected lot’s latest movement. A
            changed lot requires saving and reviewing the draft again.
          </p>
          {rows.map((r, index) => (
            <div key={r.key} className="panel">
              <AccountPicker
                kind="investment-lot"
                holdingId={holding.id}
                label={"Lot " + (index + 1)}
                value={r.lotId}
                onChange={(id) =>
                  setRows(
                    rows.map((v, i) => (i === index ? { ...v, lotId: id } : v)),
                  )
                }
                required
                initial={
                  r.lotId
                    ? [
                        {
                          id: r.lotId,
                          code: r.name,
                          name: "Selected acquisition lot",
                        },
                      ]
                    : []
                }
              />
              {disposal && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={r.disposeAll}
                    onChange={(e) =>
                      setRows(
                        rows.map((v, i) =>
                          i === index
                            ? { ...v, disposeAll: e.target.checked }
                            : v,
                        ),
                      )
                    }
                  />
                  Dispose all remaining basis in lot {index + 1}
                </label>
              )}
              {(adjustment || !r.disposeAll) && (
                <label>
                  {adjustment
                    ? "Value change"
                    : holding.unitMode === "UNIT"
                      ? "Units to dispose"
                      : "Carrying value to dispose"}{" "}
                  for lot {index + 1}
                  <input
                    required
                    inputMode="decimal"
                    value={
                      disposal && holding.unitMode === "UNIT"
                        ? r.units
                        : r.carryingAmount
                    }
                    onChange={(e) =>
                      setRows(
                        rows.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                [disposal && holding.unitMode === "UNIT"
                                  ? "units"
                                  : "carryingAmount"]: e.target.value,
                              }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                Remove lot {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={rows.length >= 100}
            onClick={() =>
              setRows([
                ...rows,
                {
                  key: crypto.randomUUID(),
                  lotId: null,
                  disposeAll: false,
                  units: "",
                  carryingAmount: "",
                  name: "",
                },
              ])
            }
          >
            Add lot
          </button>
          {adjustment && (
            <p>
              Entered lot changes total PKR {total}; the reviewed value-change
              amount must match.
            </p>
          )}
        </fieldset>
      )}
      {adjustment && (
        <label>
          Value adjustment authorization evidence
          <textarea
            name="approvalEvidence"
            required
            minLength={3}
            maxLength={1000}
            defaultValue={item?.approvalEvidence ?? ""}
          />
        </label>
      )}
      <div className="form-grid">
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
        {disposal
          ? "Bank settlement equals gross proceeds less fees. Fees, gain/loss and removed carrying value are separate; the final disposal clears the remaining paisa. Zero-carrying retirement records history without a fabricated journal."
          : "Income accrual and settlement are distinct. Value changes require the recorded holding policy and explicit review; no market prices are inferred."}
      </p>
    </FinanceActionForm>
  );
}
