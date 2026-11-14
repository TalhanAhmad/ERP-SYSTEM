"use client";
import { useState } from "react";
import type { billDetail } from "../payables/service";
import { invoicePreview } from "../receivables/preview";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import { formatPkr } from "./money-cell";
type Bill = Awaited<ReturnType<typeof billDetail>>["item"];
type Line = {
  key: string;
  taxCodeId: string | null;
  description: string;
  quantity: string;
  unitRate: string;
  discountAmount: string;
  treatment: "EXPENSE" | "PREPAYMENT" | "ASSET";
  costAccountId: string;

  projectId: string | null;
};
export function BillForm({ item, hosted }: { item?: Bill; hosted: boolean }) {
  const [lines, setLines] = useState<Line[]>(
      () =>
        item?.lines.map((l) => ({
          ...l,
          key: l.id,
          treatment: l.treatment as Line["treatment"],
        })) ?? [],
    ),
    [party, setParty] = useState(item?.partyId ?? null),
    [ar, setAr] = useState(item?.payableAccountId ?? null),
    [kind, setKind] = useState(item?.kind ?? "BILL"),
    [cash, setCash] = useState(item?.cashAccountId ?? null),
    [project, setProject] = useState(item?.projectId ?? null);
  const edit = (key: string, patch: Partial<Line>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  let preview = "Add lines to preview totals.";
  try {
    if (lines.length)
      preview = "Rounded lines less discounts: " + formatPkr(invoicePreview(lines));
  } catch {
    preview = "Check quantities, rates and discounts to preview totals.";
  }
  return (
    <FinanceActionForm
      label={item ? "Save bill draft" : "Create bill draft"}
      hosted={hosted}
      endpoint={"/api/v1/finance/bills" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/bills/"}
      business={(f) => ({
        kind,
        referenceReliable: f.get("referenceReliable") === "on",
        duplicateAcknowledged: f.get("duplicateAcknowledged") === "on",
        cashAccountId: kind === "EXPENSE" ? cash : null,
        reference: String(f.get("reference")),
        partyId: party,
        payableAccountId: kind === "BILL" ? ar : null,
        projectId: project,
        billDate: String(f.get("billDate")),
        postingDate: String(f.get("postingDate")),
        dueDate: String(f.get("dueDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        currency: "PKR",
        lines: lines.map((l) => ({
          description: l.description,
          taxCodeId: l.taxCodeId,
          quantity: l.quantity,
          unitRate: l.unitRate,
          discountAmount: l.discountAmount,
          treatment: l.treatment,
          costAccountId: l.costAccountId,
          projectId: l.projectId,
        })),
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <label>
        Purchase workflow
        <select
          value={kind}
          disabled={!!item}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="BILL">Supplier bill (pay later)</option>
          <option value="EXPENSE">Immediate expense (paid now)</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="referenceReliable"
          defaultChecked={item?.referenceReliable ?? true}
        />
        Reliable supplier reference (blocks duplicates)
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          name="duplicateAcknowledged"
          defaultChecked={item?.duplicateAcknowledged}
        />
        I checked matching supplier/date/amount records and confirmed a separate
        purchase.
      </label>
      <div className="form-grid">
        <AccountPicker
          kind="supplier"
          label="Supplier or private employee"
          value={party}
          onChange={setParty}
          required
          initial={
            item ? [{ id: item.partyId, code: "", name: item.party.name }] : []
          }
        />
        <AccountPicker
          kind="payable"
          label="Payables account"
          value={ar}
          onChange={setAr}
          required={kind === "BILL"}
          initial={
            item?.payableAccountId && item.payableAccount
              ? [{ id: item.payableAccountId, ...item.payableAccount }]
              : []
          }
        />
        {kind === "EXPENSE" && (
          <AccountPicker
            kind="cash-account"
            label="Expense payment account"
            value={cash}
            onChange={setCash}
            required
          />
        )}
        <AccountPicker
          kind="project"
          label="Bill project"
          value={project}
          onChange={setProject}
        />
      </div>
      <label>
        External reference
        <input
          name="reference"
          defaultValue={item?.reference ?? ""}
          required
          maxLength={80}
        />
      </label>
      <div className="form-grid">
        {(["billDate", "postingDate", "dueDate"] as const).map((name, i) => (
          <label key={name}>
            {["Bill date", "Posting date", "Due date"][i]}
            <input
              name={name}
              type="date"
              required
              defaultValue={item?.[name]}
            />
          </label>
        ))}
      </div>
      <label>
        Bill description
        <textarea
          name="description"
          defaultValue={item?.description}
          required
          maxLength={1000}
        />
      </label>
      <label>
        Supporting evidence reference
        <textarea
          name="evidence"
          defaultValue={item?.evidence}
          required
          minLength={3}
          maxLength={1000}
        />
      </label>
      {lines.map((l, i) => (
        <fieldset key={l.key} className="panel">
          <legend>Bill line {i + 1}</legend>
          <label>
            Line {i + 1} description
            <input
              value={l.description}
              required
              maxLength={500}
              onChange={(e) => edit(l.key, { description: e.target.value })}
            />
          </label>
          <div className="form-grid">
            {(["quantity", "unitRate", "discountAmount"] as const).map(
              (field, j) => (
                <label key={field}>
                  Line {i + 1}{" "}
                  {["quantity", "unit rate (PKR)", "discount (PKR)"][j]}
                  <input
                    value={l[field]}
                    required
                    inputMode="decimal"
                    onChange={(e) => edit(l.key, { [field]: e.target.value })}
                  />
                </label>
              ),
            )}
          </div>
          <label>
            Line {i + 1} treatment
            <select
              value={l.treatment}
              onChange={(e) =>
                edit(l.key, {
                  treatment: e.target.value as Line["treatment"],
                })
              }
            >
              <option value="EXPENSE">Expense</option>
              <option value="PREPAYMENT">Prepayment</option>
              <option value="ASSET">Fixed asset purchase</option>
            </select>
          </label>
          <AccountPicker
            kind={
              l.treatment === "EXPENSE"
                ? "cost"
                : l.treatment === "PREPAYMENT"
                  ? "prepayment"
                  : "fixed-asset"
            }
            label={"Cost category for line " + (i + 1)}
            value={l.costAccountId}
            required
            onChange={(id) => edit(l.key, { costAccountId: id ?? "" })}
          />
          <AccountPicker
            kind="tax-code"
            label={"Tax policy for line " + (i + 1)}
            value={l.taxCodeId}
            onChange={(id) => edit(l.key, { taxCodeId: id })}
          />
          <AccountPicker
            kind="project"
            label={"Project for line " + (i + 1)}
            value={l.projectId}
            onChange={(id) => edit(l.key, { projectId: id })}
          />
          <button
            type="button"
            onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
          >
            Remove bill line {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={lines.length >= 100}
        onClick={() =>
          setLines([
            ...lines,
            {
              key: crypto.randomUUID(),
              taxCodeId: null,
              description: "",
              quantity: "1",
              unitRate: "0.00",
              discountAmount: "0.00",
              treatment: "EXPENSE",
              costAccountId: "",
              projectId: null,
            },
          ])
        }
      >
        Add bill line
      </button>
      <p aria-live="polite">{preview}</p>
      <p>
        PKR. Immediate expenses include the cash payment and cannot be paid
        again as a bill. Salary costs are entered manually; attendance never
        calculates payroll.
      </p>
    </FinanceActionForm>
  );
}
export function BillAction({
  item,
  action,
  hosted,
}: {
  item: Bill;
  action: "POST" | "VOID";
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      label={action === "POST" ? "Post bill" : "Void bill draft"}
      endpoint={"/api/v1/finance/bills/" + item.id + "/" + action.toLowerCase()}
      hosted={hosted}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    >
      <label className="check-label">
        <input type="checkbox" required />I reviewed the supplier, amounts,
        evidence and posting date.
      </label>
    </FinanceActionForm>
  );
}
