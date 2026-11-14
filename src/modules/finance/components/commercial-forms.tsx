"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import type {
  projectFinanceDetail,
  commercialChildDetail,
  milestoneLinkDetail,
} from "../projects/service";
type Profile = Awaited<ReturnType<typeof projectFinanceDetail>>["item"];
type Detail = Awaited<ReturnType<typeof commercialChildDetail>>;
type Variation = Extract<Detail, { kind: "VARIATION" }>["item"];
type Milestone = Extract<Detail, { kind: "MILESTONE" }>["item"];
export function CommercialProfileForm({
  item,
  hosted,
  projectId,
  projectName,
}: {
  item?: Profile;
  hosted: boolean;
  projectId?: string;
  projectName?: string;
}) {
  const [project, setProject] = useState(item?.projectId ?? projectId ?? null),
    [client, setClient] = useState(item?.clientId ?? null);
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save commercial draft" : "Create commercial profile"}
      method={item ? "PATCH" : "POST"}
      endpoint={"/api/v1/finance/projects" + (item ? "/" + item.projectId : "")}
      redirectPrefix={item ? undefined : "/finance/projects/"}
      business={(f) => ({
        ...(item ? { expectedVersion: item.version } : { projectId: project }),
        clientId: client,
        originalContract: String(f.get("originalContract")),
        billingModel: String(f.get("billingModel")),
        terms: String(f.get("terms")),
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      {item || projectId ? (
        <p>Project: {item?.project.name ?? projectName ?? projectId}</p>
      ) : (
        <AccountPicker
          kind="commercial-project"
          label="Existing workspace project"
          value={project}
          onChange={setProject}
          required
        />
      )}
      <AccountPicker
        kind="commercial-client"
        label="Contract client"
        value={client}
        onChange={setClient}
        required
        initial={
          item
            ? [{ id: item.clientId, code: "Client", name: item.client.name }]
            : []
        }
      />
      <label>
        Original contract value (PKR)
        <input
          name="originalContract"
          inputMode="decimal"
          required
          defaultValue={item?.originalContract ?? "0.00"}
        />
      </label>
      <label>
        Billing model
        <select
          name="billingModel"
          defaultValue={item?.billingModel ?? "MILESTONE"}
        >
          {[
            ["MILESTONE", "Milestone billing"],
            ["FIXED_PRICE", "Fixed price"],
            ["TIME_BASED", "Time based"],
            ["RETAINER", "Retainer"],
          ].map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Commercial terms
        <textarea
          name="terms"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.terms}
        />
      </label>
      <label>
        Contract evidence reference
        <textarea
          name="evidence"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.evidence}
        />
      </label>
      <p>
        A commercial draft records the agreement for review. Confirm the signed
        contract separately.
      </p>
    </FinanceActionForm>
  );
}
export function CommercialProfileAction({
  item,
  hosted,
  action,
}: {
  item: Profile;
  hosted: boolean;
  action: "ACTIVATE" | "CLOSE" | "REOPEN" | "CANCEL";
}) {
  const labels = {
    ACTIVATE: "Confirm signed contract",
    CLOSE: "Close commercial profile",
    REOPEN: "Reopen commercial profile",
    CANCEL: "Cancel draft profile",
  };
  return (
    <FinanceActionForm
      hosted={hosted}
      label={labels[action]}
      endpoint={
        "/api/v1/finance/projects/" +
        item.projectId +
        "/" +
        action.toLowerCase()
      }
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
        ...(action === "ACTIVATE"
          ? {
              signedDate: String(f.get("signedDate")),
              approvalEvidence: String(f.get("approvalEvidence")),
            }
          : {}),
      })}
    >
      {action === "ACTIVATE" && (
        <>
          <label>
            Agreement signed date
            <input name="signedDate" type="date" required />
          </label>
          <label>
            Contract approval evidence
            <textarea
              name="approvalEvidence"
              minLength={3}
              maxLength={1000}
              required
            />
          </label>
        </>
      )}
      <label className="check-label">
        <input type="checkbox" required />I reviewed the commercial terms and
        this action.
      </label>
    </FinanceActionForm>
  );
}
export function CommercialVariationForm({
  item,
  projectId,
  hosted,
}: {
  item?: Variation;
  projectId: string;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save variation draft" : "Create variation draft"}
      method={item ? "PATCH" : "POST"}
      endpoint={
        "/api/v1/finance/project-variations" + (item ? "/" + item.id : "")
      }
      redirectPrefix={item ? undefined : "/finance/project-variations/"}
      business={(f) => ({
        ...(item ? { expectedVersion: item.version } : { projectId }),
        direction: String(f.get("direction")),
        amount: String(f.get("amount")),
        reference: String(f.get("reference")),
        description: String(f.get("description")),
        signedDate: String(f.get("signedDate")),
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      <label>
        Contract change
        <select name="direction" defaultValue={item?.direction ?? "INCREASE"}>
          <option value="INCREASE">Increase</option>
          <option value="DECREASE">Decrease</option>
        </select>
      </label>
      <label>
        Variation value (PKR)
        <input
          name="amount"
          inputMode="decimal"
          required
          defaultValue={item?.amount}
        />
      </label>
      <label>
        Signed amendment reference
        <input
          name="reference"
          maxLength={80}
          required
          defaultValue={item?.reference}
        />
      </label>
      <label>
        Variation description
        <textarea
          name="description"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.description}
        />
      </label>
      <label>
        Amendment signed date
        <input
          name="signedDate"
          type="date"
          required
          defaultValue={item?.signedDate}
        />
      </label>
      <label>
        Amendment evidence
        <textarea
          name="evidence"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.evidence}
        />
      </label>
      <p>
        Only separately approved signed variations contribute to contract value.
        An approved variation is retained; further changes use another reviewed
        amendment.
      </p>
    </FinanceActionForm>
  );
}
export function CommercialMilestoneForm({
  item,
  projectId,
  hosted,
}: {
  item?: Milestone;
  projectId: string;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={
        item ? "Save billing milestone draft" : "Create billing milestone draft"
      }
      method={item ? "PATCH" : "POST"}
      endpoint={
        "/api/v1/finance/billing-milestones" + (item ? "/" + item.id : "")
      }
      redirectPrefix={item ? undefined : "/finance/billing-milestones/"}
      business={(f) => ({
        ...(item ? { expectedVersion: item.version } : { projectId }),
        description: String(f.get("description")),
        amount: String(f.get("amount")),
        expectedDate: String(f.get("expectedDate")),
        dueDate: String(f.get("dueDate")),
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      <label>
        Billing milestone description
        <textarea
          name="description"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.description}
        />
      </label>
      <label>
        Planned milestone value (PKR)
        <input
          name="amount"
          inputMode="decimal"
          required
          defaultValue={item?.amount}
        />
      </label>
      <div className="form-grid">
        <label>
          Expected billing date
          <input
            name="expectedDate"
            type="date"
            required
            defaultValue={item?.expectedDate}
          />
        </label>
        <label>
          Expected payment due date
          <input
            name="dueDate"
            type="date"
            required
            defaultValue={item?.dueDate}
          />
        </label>
      </div>
      <label>
        Billing plan evidence
        <textarea
          name="evidence"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={item?.evidence}
        />
      </label>
      <p>
        Confirm the payment plan separately, then link actual posted invoice
        lines. Invoice posting remains a reviewed finance action.
      </p>
    </FinanceActionForm>
  );
}
export function CommercialChildAction({
  kind,
  item,
  hosted,
  action,
}: {
  kind: "VARIATION" | "MILESTONE";
  item: { id: string; version: number };
  hosted: boolean;
  action: "APPROVE" | "VOID" | "CONFIRM" | "CANCEL";
}) {
  const labels = {
    APPROVE: "Approve signed variation",
    VOID: "Void variation draft",
    CONFIRM: "Confirm billing milestone",
    CANCEL: "Cancel billing milestone",
  };
  return (
    <FinanceActionForm
      hosted={hosted}
      label={labels[action]}
      endpoint={
        "/api/v1/finance/" +
        (kind === "VARIATION" ? "project-variations" : "billing-milestones") +
        "/" +
        item.id +
        "/" +
        action.toLowerCase()
      }
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
        ...(["APPROVE", "CONFIRM"].includes(action)
          ? { approvalEvidence: String(f.get("approvalEvidence")) }
          : {}),
      })}
    >
      {["APPROVE", "CONFIRM"].includes(action) && (
        <label>
          Approval evidence
          <textarea
            name="approvalEvidence"
            minLength={3}
            maxLength={1000}
            required
          />
        </label>
      )}
      <label className="check-label">
        <input type="checkbox" required />I reviewed the agreement, value, dates
        and evidence.
      </label>
    </FinanceActionForm>
  );
}
export function CommercialInvoiceLinkForm({
  item,
  hosted,
}: {
  item: Milestone;
  hosted: boolean;
}) {
  const [line, setLine] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Link posted invoice line"
      endpoint="/api/v1/finance/milestone-links"
      business={(f) => ({
        milestoneId: item.id,
        invoiceLineId: line,
        reason: String(f.get("reason")),
      })}
      onSaved={() => {
        setLine(null);
        setRevision((n) => n + 1);
      }}
    >
      <AccountPicker
        key={revision}
        kind="commercial-invoice-line"
        projectId={item.profile.projectId}
        label="Posted invoice line for this project"
        value={line}
        onChange={setLine}
        required
      />
      <p>
        Links retain the original line’s net value before later credits. Use the
        invoice for its current settlement and credit history.
      </p>
    </FinanceActionForm>
  );
}
export function CommercialLinkRelease({
  item,
  hosted,
}: {
  item: Awaited<ReturnType<typeof milestoneLinkDetail>>["item"];
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Release invoice relationship"
      endpoint={"/api/v1/finance/milestone-links/" + item.id + "/release"}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    >
      <label className="check-label">
        <input type="checkbox" required />I reviewed the relationship to
        release. Its history will be retained.
      </label>
    </FinanceActionForm>
  );
}
