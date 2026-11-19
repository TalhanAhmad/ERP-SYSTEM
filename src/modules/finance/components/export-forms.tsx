"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { AccountPicker } from "./account-picker";
import {
  reportTypes,
  reportLabels,
  type ExportRequest,
} from "../reports/exports/schemas";
import { ageingBuckets } from "../reports/ageing/schemas";
import { rollforwardKinds } from "../reports/rollforwards/schemas";
export function ExportCreateForm({
  hosted,
  today,
  initial = {},
}: {
  hosted: boolean;
  today: string;
  initial?: Record<string, string | undefined>;
}) {
  const [kind, setKind] = useState<ExportRequest["reportType"]>(
      reportTypes.includes(initial.reportType as ExportRequest["reportType"])
        ? (initial.reportType as ExportRequest["reportType"])
        : "TRIAL_BALANCE",
    ),
    [account, setAccount] = useState<string | null>(initial.accountId ?? null),
    [project, setProject] = useState<string | null>(
      initial.projectId && initial.projectId !== "SHARED"
        ? initial.projectId
        : null,
    ),
    [scope, setScope] = useState(
      initial.projectId && initial.projectId !== "SHARED"
        ? "PROJECT"
        : "SHARED",
    );
  const ageing = kind.endsWith("AGEING"),
    asOf = ageing || kind === "BALANCE_SHEET",
    budget = kind === "BUDGET_VARIANCE",
    ledger = kind === "GENERAL_LEDGER";
  return (
    <FinanceActionForm
      hosted={hosted}
      endpoint="/api/v1/finance/exports"
      label="Prepare private export"
      redirectPrefix="/finance/exports/"
      business={(f) => {
        const s = (k: string) => String(f.get(k) ?? "");
        let filters: Record<string, unknown>;
        if (budget)
          filters = {
            month: s("month"),
            projectId: scope === "PROJECT" ? project : "SHARED",
          };
        else if (asOf)
          filters = {
            asOf: s("asOf"),
            q: s("q"),
            ...(ageing
              ? { includeSettled: s("includeSettled"), bucket: s("bucket") }
              : {}),
          };
        else
          filters = {
            from: s("from"),
            to: s("to"),
            ...(ledger ? { accountId: account } : { q: s("q") }),
            ...(kind === "TRIAL_BALANCE"
              ? { includeZero: s("includeZero") }
              : {}),
            ...(kind === "ROLL_FORWARD" ? { kind: s("kind") } : {}),
          };
        return {
          reportType: kind,
          filters,
          mode: s("mode"),
          reason: s("reason"),
        };
      }}
    >
      <p>
        Export every row matching these filters, up to 2,000 rows. CSV and
        printable PDF share one frozen snapshot. Downloads expire after 24 hours
        and always require current finance access.
      </p>
      <label>
        Report
        <select
          value={kind}
          onChange={(e) =>
            setKind(e.target.value as ExportRequest["reportType"])
          }
        >
          {reportTypes.map((t) => (
            <option key={t} value={t}>
              {reportLabels[t]}
            </option>
          ))}
        </select>
      </label>
      {budget ? (
        <>
          <label>
            Budget month
            <input
              name="month"
              type="month"
              defaultValue={initial.month ?? today.slice(0, 7)}
              required
              min="0001-01"
              max="9999-12"
            />
          </label>
          <label>
            Budget scope
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="SHARED">Shared company costs</option>
              <option value="PROJECT">One project</option>
            </select>
          </label>
          {scope === "PROJECT" && (
            <AccountPicker
              kind="cost-project"
              label="Budget project"
              value={project}
              onChange={setProject}
              required
            />
          )}
        </>
      ) : asOf ? (
        <label>
          As-of date
          <input
            name="asOf"
            type="date"
            defaultValue={initial.asOf ?? today}
            min="0001-01-01"
            max="9999-12-31"
            required
          />
        </label>
      ) : (
        <>
          <label>
            Posting start date
            <input
              name="from"
              type="date"
              defaultValue={initial.from ?? today.slice(0, 7) + "-01"}
              min="0001-01-01"
              max="9999-12-31"
              required
            />
          </label>
          <label>
            Posting end date
            <input
              name="to"
              type="date"
              defaultValue={initial.to ?? today}
              min="0001-01-01"
              max="9999-12-31"
              required
            />
          </label>
        </>
      )}
      {ledger && (
        <AccountPicker
          kind="report-account"
          label="Ledger account"
          value={account}
          onChange={setAccount}
          required
        />
      )}
      {!budget && !ledger && (
        <label>
          Filter displayed rows
          <input name="q" defaultValue={initial.q ?? ""} maxLength={100} />
        </label>
      )}
      {kind === "ROLL_FORWARD" && (
        <label>
          Roll-forward type
          <select name="kind" defaultValue={initial.kind ?? "PROJECTS"}>
            {rollforwardKinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      )}
      {kind === "TRIAL_BALANCE" && (
        <label>
          Include zero accounts
          <select name="includeZero" defaultValue={initial.includeZero ?? "NO"}>
            <option value="NO">No</option>
            <option value="YES">Yes</option>
          </select>
        </label>
      )}
      {ageing && (
        <>
          <label>
            Include settled documents
            <select
              name="includeSettled"
              defaultValue={initial.includeSettled ?? "NO"}
            >
              <option value="NO">No</option>
              <option value="YES">Yes</option>
            </select>
          </label>
          <label>
            Ageing bucket
            <select name="bucket" defaultValue={initial.bucket ?? "ALL"}>
              {ageingBuckets.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
        </>
      )}
      <label>
        Export purpose
        <select name="mode" defaultValue="REVIEW">
          <option value="REVIEW">Review — show incomplete checks</option>
          <option value="FINAL">
            Final — require all company checks to pass
          </option>
        </select>
      </label>
      <p>
        Final exports require complete book, presentation, bank and subledger
        checks. Narrowing the displayed rows does not narrow those checks.
        Closed-period final copies require the forthcoming controlled close
        workflow.
      </p>
    </FinanceActionForm>
  );
}
export function ExportChangeForm({
  id,
  version,
  action,
  hosted,
}: {
  id: string;
  version: number;
  action: "retry" | "cancel";
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      endpoint={`/api/v1/finance/exports/${id}/${action}`}
      label={action === "retry" ? "Retry export" : "Cancel export"}
      business={(f) => ({
        expectedVersion: version,
        reason: String(f.get("reason")),
      })}
    />
  );
}
