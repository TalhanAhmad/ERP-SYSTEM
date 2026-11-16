"use client";
import { useId } from "react";
import { FinanceActionForm } from "./finance-action-form";
import { MoneyCell } from "./money-cell";
import type { CashFlowReview } from "../reports/cash-flow/service";
const categories = ["OPERATING", "INVESTING", "FINANCING", "INTERNAL"] as const;
export function CashFlowForm({
  data,
  hosted,
}: {
  data: CashFlowReview;
  hosted: boolean;
}) {
  const evidenceId = useId();
  return (
    <FinanceActionForm
      label={data.review ? "Replace reviewed cash split" : "Confirm cash split"}
      endpoint="/api/v1/finance/cash-flow/confirm"
      hosted={hosted}
      disabled={!data.reviewAllowed}
      business={(f) => ({
        journalId: data.source.journalId,
        basisHash: data.basisHash,
        expectedReviewId: data.review?.id ?? null,
        expectedVersion: data.review?.version ?? null,
        evidence: String(f.get("evidence")),
        reason: String(f.get("reason")),
        components: data.lines.flatMap((l) =>
          categories.flatMap((category) => {
            const raw = String(f.get(l.id + ":" + category) ?? "").trim();
            if (!raw || /^0(?:\.0{1,2})?$/.test(raw)) return [];
            const amount = /^[0-9]+(?:\.[0-9]{1,2})?$/.test(raw)
              ? raw.split(".")[0] +
                "." +
                (raw.split(".")[1] ?? "").padEnd(2, "0")
              : raw;
            return [{ journalLineId: l.id, category, amount }];
          }),
        ),
      })}
    >
      <p>
        Review the original source and split each actual cash amount by purpose.
        Fees and withholding outside the cash leg are not extra cash. Internal
        components must net to zero. This records classifications without
        posting a journal.
      </p>
      {data.lines.map((l) => (
        <fieldset key={l.id}>
          <legend>
            {l.code} · {l.name} · {l.direction.toLowerCase()}{" "}
            <MoneyCell value={l.amount} />
          </legend>
          <div className="form-grid">
            {categories.map((category) => (
              <label key={category} htmlFor={l.id + ":" + category}>
                {l.code} {category.toLowerCase()}
                <input
                  id={l.id + ":" + category}
                  name={l.id + ":" + category}
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  maxLength={21}
                  placeholder="0.00"
                  disabled={data.internalOnly && category !== "INTERNAL"}
                  defaultValue={
                    l.components.find((c) => c.category === category)?.amount ??
                    (data.internalOnly && category === "INTERNAL"
                      ? l.amount
                      : "")
                  }
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label htmlFor={evidenceId}>Classification evidence</label>
      <textarea
        id={evidenceId}
        name="evidence"
        defaultValue={data.review?.evidence ?? ""}
        minLength={3}
        maxLength={1000}
        required
      />
    </FinanceActionForm>
  );
}
