"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { TextareaField } from "./textarea-field";
const subscribe = () => () => {},
  clientSnapshot = () => true,
  serverSnapshot = () => false;
type Draft = {
  id: string;
  version: number;
  completedText: string;
  remainingText: string;
  blockersText: string;
  taskIds: string[];
};
export function ReportEditor({
  report,
  tasks,
}: {
  report: Draft;
  tasks: { id: string; title: string }[];
}) {
  const router = useRouter(),
    ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot),
    version = useRef(report.version),
    retry = useRef<{
      fields: string;
      saveKey: string;
      submitKey: string;
      saveVersion: number;
      savedVersion?: number;
    } | null>(null);
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function send(
    url: string,
    method: "PATCH" | "POST",
    body: unknown,
    key: string,
  ) {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Encova-CSRF": "1",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok)
      throw new Error(json.error?.message ?? "Unable to save the report.");
    return json.data as { version: number };
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          submitter = (e.nativeEvent as SubmitEvent).submitter;
        const submit =
          submitter instanceof HTMLButtonElement &&
          submitter.value === "submit";
        const fields = new FormData(form),
          data = {
            completedText: String(fields.get("completedText") ?? ""),
            remainingText: String(fields.get("remainingText") ?? ""),
            blockersText: String(fields.get("blockersText") ?? ""),
            taskIds: fields.getAll("taskIds").map(String),
          };
        const serialized = JSON.stringify(data);
        if (!retry.current || retry.current.fields !== serialized)
          retry.current = {
            fields: serialized,
            saveKey: crypto.randomUUID(),
            submitKey: crypto.randomUUID(),
            saveVersion: version.current,
          };
        const attempt = retry.current;
        setPending(true);
        setError("");
        setMessage("");
        try {
          if (attempt.savedVersion === undefined) {
            const saved = await send(
              "/api/v1/reports/" + report.id,
              "PATCH",
              { ...data, expectedVersion: attempt.saveVersion },
              attempt.saveKey,
            );
            attempt.savedVersion = saved.version;
            version.current = saved.version;
          }
          if (submit) {
            await send(
              `/api/v1/reports/${report.id}/submit`,
              "POST",
              { expectedVersion: attempt.savedVersion },
              attempt.submitKey,
            );
            setMessage("Report submitted.");
          } else setMessage("Draft saved.");
          retry.current = null;
          router.refresh();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Unable to save the report.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className="mutation-fields" disabled={!ready || pending}>
        <TextareaField
          label="Completed work"
          name="completedText"
          maxLength={5000}
          defaultValue={report.completedText}
        />
        <TextareaField
          label="Remaining work"
          name="remainingText"
          maxLength={5000}
          defaultValue={report.remainingText}
        />
        <TextareaField
          label="Blockers"
          name="blockersText"
          maxLength={5000}
          defaultValue={report.blockersText}
        />
        {tasks.length > 0 && (
          <fieldset>
            <legend>Linked assignments (optional)</legend>
            {tasks.map((t) => (
              <label className="file-choice" key={t.id}>
                <input
                  type="checkbox"
                  name="taskIds"
                  value={t.id}
                  defaultChecked={report.taskIds.includes(t.id)}
                />
                {t.title}
              </label>
            ))}
          </fieldset>
        )}
        <p className="note">
          Submit saves these fields first, then submits that saved version for
          review.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button type="button" onClick={() => router.refresh()}>
              Reload report
            </button>
          </div>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        <div className="form-actions">
          <button className="button" name="intent" value="save">
            {pending ? "Saving…" : "Save draft"}
          </button>
          <button
            className="primary"
            name="intent"
            value="submit"
            disabled={pending}
          >
            Submit
          </button>
        </div>
      </fieldset>
    </form>
  );
}
