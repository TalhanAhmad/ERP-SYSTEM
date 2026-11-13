"use client";
import { useState } from "react";
import type { invoiceDetail } from "../receivables/service";
import { invoicePreview } from "../receivables/preview";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import { formatPkr } from "./money-cell";
type Invoice = Awaited<ReturnType<typeof invoiceDetail>>["item"];
type Line = {
  key: string;
  description: string;
  quantity: string;
  unitRate: string;
  discountAmount: string;
  recognition: "EARNED" | "DEFERRED";
  revenueAccountId: string;
  deferredAccountId: string | null;
  projectId: string | null;
};
export function InvoiceForm({
  item,
  hosted,
}: {
  item?: Invoice;
  hosted: boolean;
}) {
  const [lines, setLines] = useState<Line[]>(
      () =>
        item?.lines.map((l) => ({
          ...l,
          key: l.id,
          recognition: l.recognition as Line["recognition"],
        })) ?? [],
    ),
    [party, setParty] = useState(item?.partyId ?? null),
    [ar, setAr] = useState(item?.receivableAccountId ?? null),
    [project, setProject] = useState(item?.projectId ?? null);
  const edit = (key: string, patch: Partial<Line>) =>
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  let preview = "Add lines to preview totals.";
  try {
    if (lines.length)
      preview = "Invoice total: " + formatPkr(invoicePreview(lines));
  } catch {
    preview = "Check quantities, rates and discounts to preview totals.";
  }
  return (
    <FinanceActionForm
      label={item ? "Save invoice draft" : "Create invoice draft"}
      hosted={hosted}
      endpoint={"/api/v1/finance/invoices" + (item ? "/" + item.id : "")}
      method={item ? "PATCH" : "POST"}
      redirectPrefix={item ? undefined : "/finance/invoices/"}
      business={(f) => ({
        reference: String(f.get("reference")) || null,
        partyId: party,
        receivableAccountId: ar,
        projectId: project,
        invoiceDate: String(f.get("invoiceDate")),
        postingDate: String(f.get("postingDate")),
        dueDate: String(f.get("dueDate")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        currency: "PKR",
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitRate: l.unitRate,
          discountAmount: l.discountAmount,
          recognition: l.recognition,
          revenueAccountId: l.revenueAccountId,
          deferredAccountId: l.deferredAccountId,
          projectId: l.projectId,
        })),
        reason: String(f.get("reason")),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <div className="form-grid">
        <AccountPicker
          kind="party"
          label="Invoice client"
          value={party}
          onChange={setParty}
          required
          initial={
            item ? [{ id: item.partyId, code: "", name: item.party.name }] : []
          }
        />
        <AccountPicker
          kind="receivable"
          label="Receivables account"
          value={ar}
          onChange={setAr}
          required
          initial={
            item
              ? [{ id: item.receivableAccountId, ...item.receivableAccount }]
              : []
          }
        />
        <AccountPicker
          kind="project"
          label="Invoice project"
          value={project}
          onChange={setProject}
        />
      </div>
      <label>
        External reference
        <input
          name="reference"
          defaultValue={item?.reference ?? ""}
          maxLength={80}
        />
      </label>
      <div className="form-grid">
        {(["invoiceDate", "postingDate", "dueDate"] as const).map((name, i) => (
          <label key={name}>
            {["Invoice date", "Posting date", "Due date"][i]}
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
        Invoice description
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
          <legend>Invoice line {i + 1}</legend>
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
            Line {i + 1} recognition
            <select
              value={l.recognition}
              onChange={(e) =>
                edit(l.key, {
                  recognition: e.target.value as Line["recognition"],
                  deferredAccountId: null,
                })
              }
            >
              <option value="EARNED">Earned service</option>
              <option value="DEFERRED">Billed, not yet earned</option>
            </select>
          </label>
          <AccountPicker
            kind="revenue"
            label={"Revenue account for line " + (i + 1)}
            value={l.revenueAccountId}
            required
            onChange={(id) => edit(l.key, { revenueAccountId: id ?? "" })}
          />
          {l.recognition === "DEFERRED" && (
            <AccountPicker
              kind="deferred"
              label={"Deferred account for line " + (i + 1)}
              value={l.deferredAccountId}
              required
              onChange={(id) => edit(l.key, { deferredAccountId: id })}
            />
          )}
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
            Remove invoice line {i + 1}
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
              description: "",
              quantity: "1",
              unitRate: "0.00",
              discountAmount: "0.00",
              recognition: "EARNED",
              revenueAccountId: "",
              deferredAccountId: null,
              projectId: null,
            },
          ])
        }
      >
        Add invoice line
      </button>
      <p aria-live="polite">{preview}</p>
      <p>
        PKR. Discounts subtract from each rounded line. No tax code configured.
      </p>
    </FinanceActionForm>
  );
}
export function InvoiceAction({
  item,
  action,
  hosted,
}: {
  item: Invoice;
  action: "POST" | "VOID";
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      label={action === "POST" ? "Post invoice" : "Void invoice draft"}
      endpoint={
        "/api/v1/finance/invoices/" + item.id + "/" + action.toLowerCase()
      }
      hosted={hosted}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    >
      <label className="check-label">
        <input type="checkbox" required />I reviewed the client, amounts,
        evidence and posting date.
      </label>
    </FinanceActionForm>
  );
}
