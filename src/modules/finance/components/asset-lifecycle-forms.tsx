"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import type { assetMovementDetail } from "../assets/lifecycle/service";
type Movement = Awaited<ReturnType<typeof assetMovementDetail>>["item"];
export function AssetLifecycleForm({
  assetId,
  item,
  hosted,
  generate = false,
}: {
  assetId: string;
  item?: Movement;
  hosted: boolean;
  generate?: boolean;
}) {
  const [kind, setKind] = useState(item?.kind ?? "IMPAIRMENT"),
    [expense, setExpense] = useState(item?.expenseAccountId ?? null),
    [acc, setAcc] = useState(item?.accumulatedAccountId ?? null),
    [counter, setCounter] = useState(item?.counterAccountId ?? null),
    [cash, setCash] = useState(item?.cashAccountId ?? null),
    [gain, setGain] = useState(item?.gainAccountId ?? null),
    [loss, setLoss] = useState(item?.lossAccountId ?? null),
    [fee, setFee] = useState(item?.feeAccountId ?? null);
  const depreciation = generate || kind === "DEPRECIATION",
    disposal = kind === "DISPOSAL",
    policy = kind === "POLICY_CHANGE",
    adjustment = kind.startsWith("ADJUSTMENT_");
  return (
    <FinanceActionForm
      hosted={hosted}
      label={
        item
          ? "Save asset movement draft"
          : generate
            ? "Generate monthly draft"
            : "Create asset movement draft"
      }
      method={item ? "PATCH" : "POST"}
      endpoint={
        "/api/v1/finance/asset-movements" +
        (item ? "/" + item.id : generate ? "/generate" : "")
      }
      redirectPrefix={item ? undefined : "/finance/asset-movements/"}
      business={(f) => ({
        ...(item
          ? { expectedVersion: item.version }
          : {
              assetId,
              ...(!generate ? { kind } : { month: String(f.get("month")) }),
            }),
        postingDate: String(f.get("postingDate")),
        evidence: String(f.get("evidence")),
        approvalEvidence: String(f.get("approvalEvidence")),
        reason: String(f.get("reason")),
        ...(generate
          ? { expenseAccountId: expense, accumulatedAccountId: acc }
          : {
              description: String(f.get("description")),
              amount: policy
                ? "0.00"
                : depreciation
                  ? item!.amount
                  : String(f.get("amount")),
              feeAmount: disposal ? String(f.get("feeAmount")) : "0.00",
              expenseAccountId:
                depreciation || kind === "IMPAIRMENT" ? expense : null,
              accumulatedAccountId: depreciation ? acc : null,
              counterAccountId: adjustment ? counter : null,
              cashAccountId: disposal ? cash : null,
              gainAccountId: disposal ? gain : null,
              lossAccountId: disposal ? loss : null,
              feeAccountId: disposal ? fee : null,
              newResidual: policy ? String(f.get("newResidual")) : null,
              newLifeMonths: policy ? Number(f.get("newLifeMonths")) : null,
              newFirstMonth: policy ? String(f.get("newFirstMonth")) : null,
            }),
      })}
    >
      {!item && !generate && (
        <label>
          Asset movement type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {[
              "IMPAIRMENT",
              "ADJUSTMENT_INCREASE",
              "ADJUSTMENT_DECREASE",
              "DISPOSAL",
              "POLICY_CHANGE",
            ].map((k) => (
              <option key={k} value={k}>
                {k.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      {generate && (
        <label>
          Depreciation month
          <input name="month" type="month" required />
        </label>
      )}
      <label>
        Posting date
        <input
          name="postingDate"
          type="date"
          required
          defaultValue={item?.postingDate}
        />
      </label>
      {!generate && (
        <label>
          Description
          <textarea
            name="description"
            minLength={3}
            maxLength={1000}
            required
            defaultValue={item?.description}
          />
        </label>
      )}
      {!policy && !depreciation && (
        <label>
          {disposal ? "Gross disposal proceeds (PKR)" : "Amount (PKR)"}
          <input
            name="amount"
            inputMode="decimal"
            required
            defaultValue={item?.amount ?? "0.00"}
          />
        </label>
      )}
      {depreciation && (
        <p>
          Generation creates a reviewable draft only. Monthly charges use exact
          paisa, with the remainder in the final month; earlier months must be
          posted first. Refresh the basis after intervening movements.
        </p>
      )}
      {(depreciation || kind === "IMPAIRMENT") && (
        <AccountPicker
          kind="asset-expense"
          label="Depreciation or impairment expense"
          value={expense}
          onChange={setExpense}
          required
        />
      )}
      {depreciation && (
        <AccountPicker
          kind="accumulated-depreciation"
          label="Accumulated depreciation control"
          value={acc}
          onChange={setAcc}
          required
        />
      )}
      {adjustment && (
        <AccountPicker
          kind="journal"
          label="Reviewed adjustment counterpart"
          value={counter}
          onChange={setCounter}
          required
        />
      )}
      {disposal && (
        <>
          <AccountPicker
            kind="cash-account"
            label="Net settlement cash account (none if proceeds equal fees)"
            value={cash}
            onChange={setCash}
          />
          <AccountPicker
            kind="journal"
            type="OTHER_INCOME"
            label="Disposal gain account"
            value={gain}
            onChange={setGain}
            required
          />
          <AccountPicker
            kind="journal"
            type="OTHER_EXPENSE"
            label="Disposal loss account"
            value={loss}
            onChange={setLoss}
            required
          />
          <label>
            Disposal fees (PKR)
            <input
              name="feeAmount"
              inputMode="decimal"
              required
              defaultValue={item?.feeAmount ?? "0.00"}
            />
          </label>
          <AccountPicker
            kind="asset-expense"
            label="Disposal fee expense (required for fees)"
            value={fee}
            onChange={setFee}
          />
          <p>
            Posting clears the asset’s current cost and each actual
            accumulated-depreciation account. Net cash, fees and gain or loss
            remain separate.
          </p>
        </>
      )}
      {policy && (
        <>
          <label>
            Remaining useful life (months)
            <input
              name="newLifeMonths"
              type="number"
              min={1}
              max={1200}
              required
              defaultValue={item?.newLifeMonths ?? undefined}
            />
          </label>
          <label>
            New residual (PKR)
            <input
              name="newResidual"
              inputMode="decimal"
              required
              defaultValue={item?.newResidual ?? "0.00"}
            />
          </label>
          <label>
            First month of revised plan
            <input
              name="newFirstMonth"
              type="month"
              required
              defaultValue={item?.newFirstMonth ?? ""}
            />
          </label>
          <p>
            A reviewed prospective policy changes future charges and creates no
            journal itself.
          </p>
        </>
      )}
      <label>
        Supporting evidence reference
        <textarea
          name="evidence"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.evidence}
        />
      </label>
      <label>
        Policy or transaction approval evidence
        <textarea
          name="approvalEvidence"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.approvalEvidence}
        />
      </label>
    </FinanceActionForm>
  );
}
export function AssetLifecycleAction({
  item,
  action,
  hosted,
}: {
  item: Movement;
  action: "POST" | "VOID" | "REFRESH" | "REOPEN" | "REVERSE";
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={action.replaceAll("_", " ") + " asset movement"}
      endpoint={
        "/api/v1/finance/asset-movements/" +
        item.id +
        "/" +
        action.toLowerCase()
      }
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
            defaultValue={item.postingDate}
            required
          />
        </label>
      )}
      <label className="check-label">
        <input type="checkbox" required />I reviewed the asset, dated basis,
        accounts and approval evidence.
      </label>
    </FinanceActionForm>
  );
}
