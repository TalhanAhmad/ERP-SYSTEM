"use client";
import { useRef, useState } from "react";
import { AccountPicker } from "./account-picker";
import { FinanceActionForm } from "./finance-action-form";
import type {
  CostSource,
  costAllocationDetail,
} from "../projects/costs/service";
type Item = Awaited<ReturnType<typeof costAllocationDetail>>["item"];
type Split = {
  projectId: string | null;
  amount: string;
  percentage: string;
  name?: string;
};
export function CostAllocationForm({
  item,
  currentSource,
  hosted,
}: {
  item?: Item;
  currentSource?: CostSource;
  hosted: boolean;
}) {
  const [sourceId, setSourceId] = useState<string | null>(
      item?.sourceLineId ?? null,
    ),
    [source, setSource] = useState<CostSource | undefined>(currentSource),
    [basis, setBasis] = useState(item?.basisHash ?? ""),
    [targets, setTargets] = useState<Split[]>(
      item?.targets.map((t) => ({
        projectId: t.projectId,
        amount: t.amount,
        percentage: "",
        name: t.project?.name,
      })) ?? [{ projectId: null, amount: "0.00", percentage: "100" }],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [previewBusy, setPreviewBusy] = useState(false),
    version = useRef(0);
  async function load(id: string | null, reset: boolean) {
    const token = ++version.current;
    setError("");
    setBasis("");
    setSource(undefined);
    if (!id) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/v1/finance/cost-sources/" + id, {
          cache: "no-store",
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error.message);
      if (token !== version.current) return;
      setSource(b.data);
      setBasis(b.data.basisHash);
      if (reset)
        setTargets([
          {
            projectId: b.data.item.line.projectId,
            amount: b.data.item.net,
            percentage: "100",
          },
        ]);
    } catch (e) {
      if (token === version.current)
        setError(e instanceof Error ? e.message : "Unable to review source.");
    } finally {
      if (token === version.current) setBusy(false);
    }
  }
  function change(index: number, patch: Partial<Split>) {
    setTargets((t) => t.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }
  return (
    <>
      <section aria-label="Review source cost">
        {item ? (
          <p>
            Original source {item.sourceLine.journal.reference} ·{" "}
            {item.sourceLine.account.code} · {item.sourceLine.description}
          </p>
        ) : (
          <AccountPicker
            kind="cost-source"
            label="Posted expense source"
            value={sourceId}
            onChange={(id) => {
              setSourceId(id);
              void load(id, true);
            }}
            required
          />
        )}
        <button
          type="button"
          disabled={!sourceId || busy}
          onClick={() => void load(sourceId, false)}
        >
          Review current source
        </button>
        {busy && <p role="status">Loading source…</p>}
        {source && (
          <p>
            Current net cost PKR {source.item.net} · Latest source activity{" "}
            {source.item.latestDate} · {source.item.line.description}
          </p>
        )}
        {source && basis !== source.basisHash && (
          <p role="status">
            The saved basis is stale. Review the current source, then enter and
            save a new exact split.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      <FinanceActionForm
        hosted={hosted}
        label={
          item ? "Save cost allocation draft" : "Create cost allocation draft"
        }
        method={item ? "PATCH" : "POST"}
        endpoint={
          "/api/v1/finance/cost-allocations" + (item ? "/" + item.id : "")
        }
        redirectPrefix={item ? undefined : "/finance/cost-allocations/"}
        disabled={!basis || busy || previewBusy}
        business={(f) => ({
          ...(item
            ? { expectedVersion: item.version }
            : { sourceLineId: sourceId }),
          postingDate: String(f.get("postingDate")),
          description: String(f.get("description")),
          evidence: String(f.get("evidence")),
          basisHash: basis,
          targets: targets.map((t) => ({
            projectId: t.projectId,
            amount: t.amount,
          })),
          reason: String(f.get("reason")),
        })}
      >
        <label>
          Posting date
          <input
            name="postingDate"
            type="date"
            required
            defaultValue={item?.postingDate}
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
          Evidence reference
          <textarea
            name="evidence"
            required
            minLength={3}
            maxLength={1000}
            defaultValue={item?.evidence}
          />
        </label>
        <p>
          Split the full current net cost. Shared company cost has no project.
          Select at least one different project dimension. Amounts remain exact
          to the paisa.
        </p>
        {targets.map((t, index) => (
          <fieldset key={index} aria-label={"Split " + (index + 1)}>
            <legend>Split {index + 1}</legend>
            <AccountPicker
              kind="cost-project"
              label={"Project " + (index + 1) + " (empty means shared company)"}
              value={t.projectId}
              onChange={(id) => change(index, { projectId: id })}
              initial={
                t.projectId && t.name
                  ? [{ id: t.projectId, code: "Project", name: t.name }]
                  : []
              }
            />
            <label>
              Amount (PKR)
              <input
                aria-label={"Split " + (index + 1) + " amount (PKR)"}
                inputMode="decimal"
                required
                value={t.amount}
                onChange={(e) => change(index, { amount: e.target.value })}
              />
            </label>
            <label>
              Percentage (optional)
              <input
                aria-label={"Split " + (index + 1) + " percentage"}
                inputMode="decimal"
                value={t.percentage}
                onChange={(e) => change(index, { percentage: e.target.value })}
              />
            </label>
            {targets.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setTargets((v) => v.filter((_, i) => i !== index))
                }
              >
                Remove split {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          disabled={targets.length >= 100}
          onClick={() =>
            setTargets((t) => [
              ...t,
              { projectId: null, amount: "0.00", percentage: "" },
            ])
          }
        >
          Add split
        </button>
        <button
          type="button"
          onClick={async () => {
            const sourceVersion = version.current;
            setPreviewBusy(true);
            setError("");
            try {
              const r = await fetch(
                  "/api/v1/finance/cost-allocations/preview",
                  {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      "x-encova-csrf": "1",
                    },
                    body: JSON.stringify({
                      sourceLineId: sourceId,
                      basisHash: basis,
                      targets: targets.map((t) => ({
                        projectId: t.projectId,
                        percentage: t.percentage,
                      })),
                    }),
                  },
                ),
                b = await r.json();
              if (!r.ok) throw new Error(b.error.message);
              if (sourceVersion !== version.current) return;
              setTargets((t) =>
                t.map((v, i) => ({ ...v, amount: b.data.targets[i].amount })),
              );
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Unable to calculate split.",
              );
            } finally {
              setPreviewBusy(false);
            }
          }}
        >
          Calculate exact amounts from percentages
        </button>
        <p>
          Percentages must total 100%. Remainder paisa go to the largest
          fractional shares, in split order for ties. Review calculated amounts
          before saving.
        </p>
      </FinanceActionForm>
    </>
  );
}
export function CostAllocationAction({
  item,
  hosted,
  action,
}: {
  item: Item;
  hosted: boolean;
  action: "POST" | "VOID" | "REVERSE";
}) {
  const labels = {
    POST: "Post cost allocation",
    VOID: "Void cost allocation draft",
    REVERSE: "Reverse cost allocation",
  };
  return (
    <FinanceActionForm
      hosted={hosted}
      label={labels[action]}
      endpoint={
        "/api/v1/finance/cost-allocations/" +
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
            type="date"
            name="postingDate"
            min={item.postingDate}
            required
          />
        </label>
      )}
    </FinanceActionForm>
  );
}
