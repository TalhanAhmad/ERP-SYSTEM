"use client";
import { useId, useState } from "react";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import type { budgetDetail, forecastDetail } from "../planning/service";
type Budget = Awaited<ReturnType<typeof budgetDetail>>["item"];
type Forecast = Awaited<ReturnType<typeof forecastDetail>>["item"];
export function BudgetForm({
  item,
  previous,
  hosted,
  projectId,
}: {
  item?: Budget;
  previous?: Budget;
  hosted: boolean;
  projectId?: string;
}) {
  const initial = item ?? previous,
    [project, setProject] = useState<string | null>(
      initial?.projectId ?? projectId ?? null,
    ),
    [lines, setLines] = useState(
      initial?.lines.map((l) => ({
        accountId: l.accountId,
        amount: l.amount,
        code: l.account.code,
        name: l.account.name,
      })) ?? [{ accountId: "", amount: "0.00", code: "", name: "" }],
    );
  return (
    <FinanceActionForm
      hosted={hosted}
      label={
        item
          ? "Save budget draft"
          : previous
            ? "Create budget revision"
            : "Create budget draft"
      }
      method={item ? "PATCH" : "POST"}
      endpoint={"/api/v1/finance/budgets" + (item ? "/" + item.id : "")}
      redirectPrefix={item ? undefined : "/finance/budgets/"}
      business={(f) => ({
        ...(item
          ? { expectedVersion: item.version }
          : {
              month: String(f.get("month")),
              projectId: project,
              previousId: previous?.id ?? null,
              previousVersion: previous?.version ?? null,
            }),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        lines: lines.map((l) => ({ accountId: l.accountId, amount: l.amount })),
        reason: String(f.get("reason")),
      })}
    >
      {initial ? (
        <>
          <p>
            Month {initial.month} · {initial.project?.name ?? "Shared company"}
            {previous ? " · Revises " + previous.number : ""}
          </p>
          {previous && (
            <input type="hidden" name="month" value={previous.month} />
          )}
        </>
      ) : (
        <>
          <label>
            Budget month
            <input
              type="month"
              name="month"
              min="0001-01"
              max="9999-12"
              required
            />
          </label>
          <AccountPicker
            kind="cost-project"
            label="Budget project (empty means shared company)"
            value={project}
            onChange={setProject}
          />
        </>
      )}
      <label>
        Description
        <input
          name="description"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={initial?.description}
        />
      </label>
      <label>
        Planning evidence
        <textarea
          name="evidence"
          minLength={3}
          maxLength={1000}
          required
          defaultValue={initial?.evidence}
        />
      </label>
      {lines.map((l, index) => (
        <fieldset key={index}>
          <legend>Budget line {index + 1}</legend>
          <AccountPicker
            kind="budget-account"
            label={"Expense account " + (index + 1)}
            value={l.accountId}
            onChange={(id) =>
              setLines((v) =>
                v.map((r, i) =>
                  i === index ? { ...r, accountId: id ?? "" } : r,
                ),
              )
            }
            required
            initial={
              l.accountId
                ? [{ id: l.accountId, code: l.code, name: l.name }]
                : []
            }
          />
          <label>
            Planned cost (PKR)
            <input
              aria-label={"Budget line " + (index + 1) + " amount (PKR)"}
              inputMode="decimal"
              required
              value={l.amount}
              onChange={(e) =>
                setLines((v) =>
                  v.map((r, i) =>
                    i === index ? { ...r, amount: e.target.value } : r,
                  ),
                )
              }
            />
          </label>
          {lines.length > 1 && (
            <button
              type="button"
              onClick={() => setLines((v) => v.filter((_, i) => i !== index))}
            >
              Remove budget line {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        disabled={lines.length >= 100}
        onClick={() =>
          setLines((v) => [
            ...v,
            { accountId: "", amount: "0.00", code: "", name: "" },
          ])
        }
      >
        Add budget line
      </button>
      <p>
        Saving a draft leaves the approved plan in effect. Approval replaces it
        with a retained revision. Budget warnings are advisory.
      </p>
    </FinanceActionForm>
  );
}
export function BudgetAction({
  item,
  hosted,
  action,
}: {
  item: Budget;
  hosted: boolean;
  action: "APPROVE" | "VOID";
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label={action === "APPROVE" ? "Approve budget" : "Void budget draft"}
      endpoint={
        "/api/v1/finance/budgets/" + item.id + "/" + action.toLowerCase()
      }
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
        ...(action === "APPROVE"
          ? { approvalEvidence: String(f.get("approvalEvidence")) }
          : {}),
      })}
    >
      {action === "APPROVE" && (
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
    </FinanceActionForm>
  );
}
export function ForecastForm({
  item,
  hosted,
  projectId,
}: {
  item?: Forecast;
  hosted: boolean;
  projectId?: string;
}) {
  const fieldId = useId();
  const [project, setProject] = useState<string | null>(
      item?.projectId ?? projectId ?? null,
    ),
    [party, setParty] = useState<string | null>(item?.partyId ?? null);
  return (
    <FinanceActionForm
      hosted={hosted}
      label={item ? "Save cash forecast" : "Create cash forecast"}
      method={item ? "PATCH" : "POST"}
      endpoint={"/api/v1/finance/forecasts" + (item ? "/" + item.id : "")}
      redirectPrefix={item ? undefined : "/finance/forecasts/"}
      business={(f) => ({
        ...(item ? { expectedVersion: item.version } : {}),
        kind: String(f.get("kind")),
        expectedDate: String(f.get("expectedDate")),
        amount: String(f.get("amount")),
        projectId: project,
        partyId: party,
        likelihood: String(f.get("likelihood")),
        likelihoodNote: String(f.get("likelihoodNote")),
        description: String(f.get("description")),
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
      })}
    >
      <label htmlFor={fieldId + "-direction"}>Expected cash direction</label>
      <select
        id={fieldId + "-direction"}
        name="kind"
        defaultValue={item?.kind ?? "RECEIPT"}
      >
        <option value="RECEIPT">Expected receipt</option>
        <option value="PAYMENT">Expected payment</option>
      </select>
      <label>
        Expected cash date
        <input
          name="expectedDate"
          type="date"
          required
          defaultValue={item?.expectedDate}
        />
      </label>
      <label>
        Expected amount (PKR)
        <input
          name="amount"
          inputMode="decimal"
          required
          defaultValue={item?.amount}
        />
      </label>
      <AccountPicker
        kind="cost-project"
        label="Forecast project (optional)"
        value={project}
        onChange={setProject}
        initial={
          item?.projectId && item.project
            ? [{ id: item.projectId, code: "Project", name: item.project.name }]
            : []
        }
      />
      <AccountPicker
        kind="forecast-party"
        label="Forecast party (optional)"
        value={party}
        onChange={setParty}
        initial={
          item?.partyId && item.party
            ? [{ id: item.partyId, code: "Party", name: item.party.name }]
            : []
        }
      />
      <label htmlFor={fieldId + "-likelihood"}>Likelihood</label>
      <select
        id={fieldId + "-likelihood"}
        name="likelihood"
        defaultValue={item?.likelihood ?? "POSSIBLE"}
      >
        <option>POSSIBLE</option>
        <option>LIKELY</option>
        <option>COMMITTED</option>
      </select>
      <label>
        Likelihood note
        <textarea
          name="likelihoodNote"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={item?.likelihoodNote}
        />
      </label>
      <label>
        Description
        <input
          name="description"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={item?.description}
        />
      </label>
      <label>
        Forecast evidence
        <textarea
          name="evidence"
          required
          minLength={3}
          maxLength={1000}
          defaultValue={item?.evidence}
        />
      </label>
      <p>
        A forecast records an expectation. It does not record money received,
        money paid or an accounting entry.
      </p>
    </FinanceActionForm>
  );
}
export function ForecastAction({
  item,
  hosted,
}: {
  item: Forecast;
  hosted: boolean;
}) {
  const action = item.state === "ACTIVE" ? "cancel" : "reopen";
  return (
    <FinanceActionForm
      hosted={hosted}
      label={
        action === "cancel" ? "Cancel cash forecast" : "Reopen cash forecast"
      }
      endpoint={"/api/v1/finance/forecasts/" + item.id + "/" + action}
      business={(f) => ({
        expectedVersion: item.version,
        reason: String(f.get("reason")),
      })}
    />
  );
}
export function VarianceFilters({
  month,
  projectId,
  projectName,
}: {
  month: string;
  projectId: string | null;
  projectName?: string;
}) {
  const [project, setProject] = useState(projectId);
  return (
    <form method="get" className="form-grid">
      <label>
        Budget month
        <input
          type="month"
          name="month"
          min="0001-01"
          max="9999-12"
          required
          defaultValue={month}
        />
      </label>
      <input type="hidden" name="projectId" value={project ?? "SHARED"} />
      <AccountPicker
        kind="cost-project"
        label="Variance project (empty means shared company)"
        value={project}
        onChange={setProject}
        initial={
          projectId && projectName
            ? [{ id: projectId, code: "Project", name: projectName }]
            : []
        }
      />
      <button type="submit">Show budget variance</button>
    </form>
  );
}
