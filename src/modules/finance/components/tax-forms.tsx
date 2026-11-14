"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
export function TaxCodeForm({ hosted }: { hosted: boolean }) {
  const [kind, setKind] = useState("INDIRECT"),
    [input, setInput] = useState<string | null>(null),
    [output, setOutput] = useState<string | null>(null);
  return (
    <FinanceActionForm
      label="Create reviewed tax policy"
      hosted={hosted}
      endpoint="/api/v1/finance/tax-codes"
      business={(f) => ({
        code: String(f.get("code")),
        name: String(f.get("name")),
        kind,
        effectiveFrom: String(f.get("effectiveFrom")),
        effectiveTo: String(f.get("effectiveTo")) || null,
        rate: String(f.get("rate")),
        mode: String(f.get("mode")),
        rounding: String(f.get("rounding")),
        inputAccountId: input,
        outputAccountId: output,
        policyEvidence: String(f.get("policyEvidence")),
        reason: String(f.get("reason")),
      })}
    >
      <div className="form-grid">
        <label>
          Policy code
          <input
            name="code"
            required
            maxLength={40}
            pattern="[A-Z0-9][A-Z0-9._-]*"
          />
        </label>
        <label>
          Policy name
          <input name="name" required maxLength={120} />
        </label>
        <label>
          Policy kind
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setInput(null);
              setOutput(null);
            }}
          >
            <option value="INDIRECT">Invoice and purchase tax</option>
            <option value="WITHHOLDING">
              Evidenced settlement withholding
            </option>
          </select>
        </label>
        <label>
          Effective from
          <input name="effectiveFrom" type="date" required />
        </label>
        <label>
          Effective to (optional)
          <input name="effectiveTo" type="date" />
        </label>
        <label>
          Reviewed rate (%)
          <input name="rate" inputMode="decimal" required />
        </label>
        <label>
          Tax mode
          <select name="mode">
            <option value="EXCLUSIVE">Exclusive</option>
            {kind === "INDIRECT" && (
              <option value="INCLUSIVE">Inclusive</option>
            )}
          </select>
        </label>
        <label>
          Rounding policy
          <select name="rounding">
            <option value="HALF_UP">Round half up per line</option>
            <option value="DOWN">Round down per line</option>
          </select>
        </label>
      </div>
      <AccountPicker
        kind={kind === "INDIRECT" ? "tax-input" : "withholding-receivable"}
        label="Recoverable input control"
        value={input}
        onChange={setInput}
        required
      />
      <AccountPicker
        kind={kind === "INDIRECT" ? "tax-output" : "withholding-payable"}
        label="Output liability control"
        value={output}
        onChange={setOutput}
        required
      />
      <label>
        Company approval and policy evidence
        <textarea
          name="policyEvidence"
          required
          minLength={3}
          maxLength={1000}
        />
      </label>
      <label className="check-label">
        <input type="checkbox" required />
        The company reviewed the rate, effective dates, calculation and mapped
        controls.
      </label>
      <p>
        New documents default to no tax. Withholding amounts are entered from
        settlement evidence. No rates or statutory compliance are inferred.
      </p>
    </FinanceActionForm>
  );
}
export function RetireTaxCode({ id, hosted }: { id: string; hosted: boolean }) {
  return (
    <FinanceActionForm
      label="Retire policy"
      hosted={hosted}
      endpoint={"/api/v1/finance/tax-codes/" + id + "/retire"}
      business={(f) => ({ reason: String(f.get("reason")) })}
    >
      <p>
        Existing posted snapshots stay permanent. A retired code cannot be used
        for new posting.
      </p>
    </FinanceActionForm>
  );
}
