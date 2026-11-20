"use client";
import { useState } from "react";
import { FinanceActionForm } from "./finance-action-form";
import type { OpeningBatch, OpeningPreview } from "../opening/types";
export function OpeningUploadForm({ hosted }: { hosted: boolean }) {
  const [source, setSource] = useState<{
      fileName: string;
      sourceText: string;
    } | null>(null),
    [error, setError] = useState("");
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Preview opening file"
      endpoint="/api/v1/finance/openings"
      redirectPrefix="/finance/openings/"
      submitDisabled={!source}
      business={(f) => ({ ...source, reason: String(f.get("reason")) })}
    >
      <p>
        Choose a reviewed UTF-8 JSON file. Preview creates no journals. Maximum
        180 KB, 200 trial-balance accounts and 200 detailed positions.
      </p>
      <label>
        Reviewed opening file
        <input
          type="file"
          accept=".json,application/json"
          required
          onChange={async (e) => {
            setSource(null);
            setError("");
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 180000)
                throw new Error("Opening file exceeds 180 KB.");
              const sourceText = new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: true,
              }).decode(await file.arrayBuffer());
              JSON.parse(sourceText);
              setSource({ fileName: file.name, sourceText });
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Use a valid UTF-8 JSON file.",
              );
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </FinanceActionForm>
  );
}
export function OpeningPostForm({
  value,
  preview,
  hosted,
}: {
  value: OpeningBatch;
  preview: OpeningPreview;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Post reviewed opening balances"
      endpoint={`/api/v1/finance/openings/${value.id}/post`}
      submitDisabled={!preview.ready}
      business={(f) => ({
        expectedVersion: value.version,
        basisHash: preview.basisHash,
        reviewEvidence: String(f.get("reviewEvidence")),
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Post the detailed control positions and remaining trial-balance accounts
        once. The import must prove equal totals and zero clearing. Historical
        documents retain their original references and due dates. Posting before
        the cutover becomes unavailable.
      </p>
      <label>
        Cutover and reconciliation approval evidence
        <textarea
          name="reviewEvidence"
          required
          minLength={3}
          maxLength={1000}
        />
      </label>
    </FinanceActionForm>
  );
}
export function OpeningVoidForm({
  value,
  hosted,
}: {
  value: OpeningBatch;
  hosted: boolean;
}) {
  return (
    <FinanceActionForm
      hosted={hosted}
      label="Void opening draft"
      endpoint={`/api/v1/finance/openings/${value.id}/void`}
      business={(f) => ({
        expectedVersion: value.version,
        reason: String(f.get("reason")),
      })}
    >
      <p>
        Retain this draft and its source file, then upload the corrected file.
        Posted openings cannot be voided.
      </p>
    </FinanceActionForm>
  );
}
