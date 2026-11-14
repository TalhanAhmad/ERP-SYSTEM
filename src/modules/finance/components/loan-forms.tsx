"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import { loanKinds } from "../treasury/kinds";
import type { loanDetail } from "../funding/loans/service";
import type { movementDetail } from "../treasury/service";
type Loan = Awaited<ReturnType<typeof loanDetail>>["item"];
type Movement = Awaited<ReturnType<typeof movementDetail>>["item"];
export function LoanForm({ item, hosted }: { item?: Loan; hosted: boolean }) {
  const [direction, setDirection] = useState(item?.direction ?? "RECEIVED"),
    [party, setParty] = useState(item?.partyId ?? null),
    [principal, setPrincipal] = useState(item?.principalAccountId ?? null),
    [interest, setInterest] = useState(item?.interestAccountId ?? null),
    [result, setResult] = useState(item?.interestResultAccountId ?? null),
    [schedule, setSchedule] = useState(
      (item?.manualSchedule ?? []) as {
        dueDate: string;
        principal: string;
        interest: string;
      }[],
    );
  const received = direction === "RECEIVED";
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save loan terms" : "Create loan agreement"}
      endpoint={"/api/v1/finance/loans" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/loans/"}
      business={(f) => ({
        name: String(f.get("name")),
        direction,
        partyId: party,
        startDate: String(f.get("startDate")),
        maturityDate: String(f.get("maturityDate")),
        agreedPrincipal: String(f.get("agreedPrincipal")),
        annualRate: String(f.get("annualRate")) || null,
        agreement: String(f.get("agreement")),
        principalAccountId: principal,
        interestAccountId: interest,
        interestResultAccountId: result,
        manualSchedule: schedule,
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <label>
        Loan name
        <input name="name" required maxLength={120} defaultValue={item?.name} />
      </label>
      <label>
        Loan direction
        <select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            setPrincipal(null);
            setInterest(null);
            setResult(null);
          }}
        >
          <option value="RECEIVED">Received by Encova (liability)</option>
          <option value="ADVANCED">Advanced by Encova (asset)</option>
        </select>
      </label>
      <AccountPicker
        kind="contributor"
        label="Lender or borrower"
        value={party}
        onChange={setParty}
        required
        initial={
          item && party ? [{ id: party, code: "", name: item.party.name }] : []
        }
      />
      <AccountPicker
        key={"p" + direction}
        kind={received ? "loan-payable" : "loan-receivable"}
        label="Principal control account"
        value={principal}
        onChange={setPrincipal}
        required
        initial={
          item && principal ? [{ id: principal, ...item.principalAccount }] : []
        }
      />
      <AccountPicker
        key={"i" + direction}
        kind={received ? "interest-payable" : "interest-receivable"}
        label="Interest control account"
        value={interest}
        onChange={setInterest}
        required
        initial={
          item && interest ? [{ id: interest, ...item.interestAccount }] : []
        }
      />
      <AccountPicker
        key={"r" + direction}
        kind={received ? "fee" : "revenue"}
        type={received ? "OTHER_EXPENSE" : "OTHER_INCOME"}
        label={
          received ? "Interest expense account" : "Interest income account"
        }
        value={result}
        onChange={setResult}
        required
        initial={
          item && result ? [{ id: result, ...item.interestResultAccount }] : []
        }
      />
      <div className="form-grid">
        <label>
          Agreement start
          <input
            type="date"
            name="startDate"
            required
            defaultValue={item?.startDate}
          />
        </label>
        <label>
          Maturity date
          <input
            type="date"
            name="maturityDate"
            required
            defaultValue={item?.maturityDate}
          />
        </label>
        <label>
          Agreed principal limit (PKR)
          <input
            name="agreedPrincipal"
            required
            inputMode="decimal"
            defaultValue={item?.agreedPrincipal}
          />
        </label>
        <label>
          Annual rate for reference (optional)
          <input
            name="annualRate"
            inputMode="decimal"
            defaultValue={item?.annualRate ?? ""}
          />
        </label>
      </div>
      <label>
        Agreement and reviewed interest policy
        <textarea
          name="agreement"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={item?.agreement}
        />
      </label>
      <fieldset>
        <legend>Manual repayment plan (optional)</legend>
        <p>
          Planned amounts are entered from the agreement. They create no accrual
          or payment.
        </p>
        {schedule.map((row, index) => (
          <div key={index} className="form-grid">
            <label>
              Plan {index + 1} due date
              <input
                type="date"
                required
                value={row.dueDate}
                onChange={(e) =>
                  setSchedule(
                    schedule.map((r, i) =>
                      i === index ? { ...r, dueDate: e.target.value } : r,
                    ),
                  )
                }
              />
            </label>
            {(["principal", "interest"] as const).map((k) => (
              <label key={k}>
                Plan {index + 1} {k} (PKR)
                <input
                  inputMode="decimal"
                  required
                  value={row[k]}
                  onChange={(e) =>
                    setSchedule(
                      schedule.map((r, i) =>
                        i === index ? { ...r, [k]: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() =>
                setSchedule(schedule.filter((_, i) => i !== index))
              }
            >
              Remove plan {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={schedule.length >= 120}
          onClick={() =>
            setSchedule([
              ...schedule,
              { dueDate: "", principal: "0.00", interest: "0.00" },
            ])
          }
        >
          Add planned repayment
        </button>
      </fieldset>
      <p>
        Creating an agreement posts no journal. Record principal and reviewed
        interest separately. Terms freeze after the first posted movement; no
        automatic amortization is inferred.
      </p>
    </FinanceActionForm>
  );
}
export function LoanMovementForm({
  loan,
  item,
  hosted,
}: {
  loan: Pick<Loan, "id" | "name" | "direction">;
  item?: Movement;
  hosted: boolean;
}) {
  const [kind, setKind] = useState(item?.kind ?? "LOAN_DISBURSEMENT"),
    [bank, setBank] = useState(item?.fromCashId ?? item?.toCashId ?? null),
    [counter, setCounter] = useState(item?.counterAccountId ?? null),
    adjustment = [
      "LOAN_PRINCIPAL_INCREASE",
      "LOAN_PRINCIPAL_DECREASE",
    ].includes(kind),
    cash = kind !== "LOAN_INTEREST_ACCRUAL" && !adjustment,
    incoming =
      (loan.direction === "RECEIVED" && kind === "LOAN_DISBURSEMENT") ||
      (loan.direction === "ADVANCED" &&
        ["LOAN_REPAYMENT", "LOAN_INTEREST_SETTLEMENT"].includes(kind));
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save loan movement" : "Create loan movement"}
      endpoint={"/api/v1/finance/movements" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/movements/"}
      business={(f) => ({
        kind,
        loanId: loan.id,
        amount: String(f.get("amount")),
        reference: String(f.get("reference")),
        documentDate: String(f.get("documentDate")),
        postingDate: String(f.get("postingDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        currency: "PKR",
        fromCashId: cash && !incoming ? bank : null,
        toCashId: cash && incoming ? bank : null,
        counterAccountId: adjustment ? counter : null,
        approvalEvidence: adjustment ? String(f.get("approvalEvidence")) : null,
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <p>
        {loan.name} · {loan.direction}
      </p>
      <label>
        Loan movement classification
        <select
          value={kind}
          disabled={!!item}
          onChange={(e) => setKind(e.target.value)}
        >
          {loanKinds.map((k) => (
            <option key={k} value={k}>
              {k.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      {cash && (
        <AccountPicker
          kind="cash-account"
          label={incoming ? "Receiving bank or cash" : "Paying bank or cash"}
          value={bank}
          onChange={setBank}
          required
          initial={
            item && bank
              ? [
                  {
                    id: bank,
                    code: "",
                    name:
                      item.fromCash?.name ??
                      item.toCash?.name ??
                      "Selected bank",
                  },
                ]
              : []
          }
        />
      )}
      {adjustment && (
        <>
          <AccountPicker
            kind="journal"
            label="Reviewed adjustment counter account"
            value={counter}
            onChange={setCounter}
            required
            initial={
              item?.counterAccount && counter
                ? [{ id: counter, ...item.counterAccount }]
                : []
            }
          />
          <label>
            Adjustment authorization evidence
            <textarea
              name="approvalEvidence"
              required
              minLength={3}
              maxLength={1000}
              defaultValue={item?.approvalEvidence ?? ""}
            />
          </label>
        </>
      )}
      <div className="form-grid">
        <label>
          Amount (PKR)
          <input
            name="amount"
            required
            inputMode="decimal"
            defaultValue={item?.amount}
          />
        </label>
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
            type="date"
            name="documentDate"
            required
            defaultValue={item?.documentDate}
          />
        </label>
        <label>
          Posting date
          <input
            type="date"
            name="postingDate"
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
        Principal and accrued interest have separate dated balances. This
        records reviewed transactions; it does not initiate a payment.
      </p>
    </FinanceActionForm>
  );
}

export function LoanArchiveForm({
  item,
  hosted,
}: {
  item: Loan;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item.active ? "Archive settled loan" : "Reactivate loan"}
      endpoint={
        "/api/v1/finance/loans/" +
        item.id +
        (item.active ? "/archive" : "/reactivate")
      }
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    >
      <p>Archival retains history and requires zero principal and interest.</p>
    </FinanceActionForm>
  );
}
