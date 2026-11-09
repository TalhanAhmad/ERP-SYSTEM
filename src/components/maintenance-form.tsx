"use client";
import { TextareaField } from "./textarea-field";
import { MutationForm } from "./mutation-form";
export function MaintenanceForm({
  today,
  date,
  runId,
  attempts,
}: {
  today: string;
  date: string;
  runId?: string;
  attempts?: number;
}) {
  return (
    <MutationForm
      endpoint="/api/v1/operations/maintenance"
      label={runId ? "Retry maintenance" : "Run maintenance"}
      transform={(f) => ({
        ...Object.fromEntries(f),
        ...(runId ? { runId, expectedAttempts: attempts } : {}),
      })}
    >
      <label>
        Report work date
        <input
          name="workDate"
          type="date"
          required
          max={today}
          defaultValue={date}
          readOnly={!!runId}
        />
      </label>
      <TextareaField
        label="Reason for maintenance"
        name="reason"
        required
        maxLength={500}
      />
      <p className="note">
        Rechecks missing-report reminders and expires old invitation links. It
        does not alter attendance or send employee email.
      </p>
    </MutationForm>
  );
}
