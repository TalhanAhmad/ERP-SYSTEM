"use client";
import { useRouter } from "next/navigation";
import { MutationForm } from "./mutation-form";
export function QueueAttendanceJob({
  today,
  defaultDate,
}: {
  today: string;
  defaultDate: string;
}) {
  return (
    <MutationForm
      endpoint="/api/v1/operations/attendance-jobs"
      label="Queue attendance check"
      successMessage="Attendance check queued. Run its next batch below."
    >
      <div className="form-grid">
        <label>
          Company work date
          <input
            type="date"
            name="workDate"
            max={today}
            defaultValue={defaultDate}
            required
          />
        </label>
        <label>
          Reason for attendance check
          <input name="reason" maxLength={500} required />
        </label>
      </div>
    </MutationForm>
  );
}
export function RunJob({
  id,
  version,
  status,
}: {
  id: string;
  version: number;
  status: string;
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/operations/attendance-jobs/${id}/run`}
      label={status === "QUEUED" ? "Run next batch" : "Retry attendance check"}
      successMessage="Request recorded. Review progress and status."
      transform={(f) => ({
        expectedVersion: version,
        reason: String(f.get("reason")),
      })}
    >
      <label>
        Reason for this attempt
        <input name="reason" required maxLength={500} />
      </label>
    </MutationForm>
  );
}
export function RefreshJobs() {
  const router = useRouter();
  return <button onClick={() => router.refresh()}>Refresh status</button>;
}
