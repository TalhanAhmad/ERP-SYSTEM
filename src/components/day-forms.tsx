"use client";
import { TextareaField } from "./textarea-field";
import { MutationForm } from "./mutation-form";
export function CheckButton({ kind }: { kind: "in" | "out" }) {
  return (
    <MutationForm
      endpoint={`/api/v1/attendance/check-${kind}`}
      label={kind === "in" ? "Check in" : "Check out"}
    />
  );
}
export function LeaveForm() {
  return (
    <MutationForm endpoint="/api/v1/leave" label="Request leave">
      <div className="form-grid">
        <label>
          Start date
          <input type="date" name="startDate" required />
        </label>
        <label>
          End date
          <input type="date" name="endDate" required />
        </label>
        <label>
          Leave type
          <select name="type">
            <option>PERSONAL</option>
            <option>SICK</option>
            <option>OTHER</option>
          </select>
        </label>
      </div>
      <TextareaField
        label="Private note (optional)"
        name="privateNote"
        maxLength={2000}
      />
    </MutationForm>
  );
}
export function DecisionForm({
  resource,
  id,
  version,
  action,
}: {
  resource: "leave" | "corrections" | "reports";
  id: string;
  version: number;
  action: "approve" | "reject" | "cancel" | "submit" | "acknowledge" | "return";
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/${resource}/${id}/${action}`}
      label={action.replace(/^./, (s) => s.toUpperCase())}
      transform={(f) => ({
        expectedVersion: version,
        ...(resource === "corrections" && action === "reject"
          ? { reason: f.get("reason") }
          : {}),
      })}
    >
      {resource === "corrections" && action === "reject" && (
        <TextareaField
          label="Reason for rejection"
          name="reason"
          required
          maxLength={1000}
        />
      )}
    </MutationForm>
  );
}
export function CorrectionForm({
  days,
}: {
  days: { id: string; date: string; version: number }[];
}) {
  return (
    <MutationForm
      endpoint="/api/v1/corrections"
      label="Request correction"
      transform={(f) => {
        const day = days.find((d) => d.id === f.get("attendanceDayId"))!;
        return {
          attendanceDayId: day.id,
          expectedDayVersion: day.version,
          proposedIn: new Date(String(f.get("proposedIn"))).toISOString(),
          proposedOut: new Date(String(f.get("proposedOut"))).toISOString(),
          reason: f.get("reason"),
        };
      }}
    >
      <label>
        Attendance date
        <select name="attendanceDayId" required>
          <option value="">Select a recorded day</option>
          {days.map((d) => (
            <option value={d.id} key={d.id}>
              {d.date}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Proposed check-in (your local time)
          <input type="datetime-local" name="proposedIn" required />
        </label>
        <label>
          Proposed check-out (your local time)
          <input type="datetime-local" name="proposedOut" required />
        </label>
      </div>
      <TextareaField label="Reason" name="reason" required maxLength={2000} />
      <p className="note">
        Times must fit the assigned shift. An independent HR administrator must
        approve changes.
      </p>
    </MutationForm>
  );
}
export function PolicyForm() {
  return (
    <MutationForm
      endpoint="/api/v1/schedules"
      label="Create schedule"
      transform={(f) => ({
        name: f.get("name"),
        localStart: f.get("localStart"),
        localEnd: f.get("localEnd"),
        weekdays: f.getAll("weekdays").map(Number),
        graceMinutes: Number(f.get("graceMinutes")),
        closingBufferMinutes: Number(f.get("closingBufferMinutes")),
      })}
    >
      <label>
        Schedule name
        <input name="name" required maxLength={120} />
      </label>
      <div className="form-grid">
        <label>
          Shift starts (Asia/Karachi)
          <input type="time" name="localStart" required defaultValue="09:00" />
        </label>
        <label>
          Shift ends (Asia/Karachi)
          <input type="time" name="localEnd" required defaultValue="17:00" />
        </label>
        <fieldset>
          <legend>Working weekdays</legend>
          {[
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ].map((day, i) => (
            <label className="file-choice" key={day}>
              <input
                type="checkbox"
                name="weekdays"
                value={i}
                defaultChecked={i >= 1 && i <= 5}
              />
              {day}
            </label>
          ))}
        </fieldset>
        <label>
          Grace minutes
          <input name="graceMinutes" type="number" min="0" max="120" required />
        </label>
        <label>
          Closing buffer minutes
          <input
            name="closingBufferMinutes"
            type="number"
            min="0"
            max="240"
            required
          />
        </label>
      </div>
      <p className="note">
        Times use a day shift: the end must be later than the start (17:00 means
        5 PM). Confirm actual company policy before assigning.
      </p>
    </MutationForm>
  );
}
export function ScheduleAssignmentForm({
  people,
  policies,
}: {
  people: { id: string; username: string }[];
  policies: { id: string; name: string }[];
}) {
  return (
    <MutationForm
      endpoint="/api/v1/schedule-assignments"
      label="Assign schedule"
      transform={(f) => {
        const value = Object.fromEntries(f);
        if (!value.endDate) delete value.endDate;
        return value;
      }}
    >
      <div className="form-grid">
        <label>
          Person
          <select name="userId" required>
            <option value="">Select person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                @{p.username}
              </option>
            ))}
          </select>
        </label>
        <label>
          Schedule
          <select name="policyId" required>
            <option value="">Select schedule</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Effective start
          <input name="startDate" type="date" required />
        </label>
        <label>
          Effective end (optional)
          <input name="endDate" type="date" />
        </label>
      </div>
    </MutationForm>
  );
}
export function ReportForm({
  date,
  report,
  tasks = [],
}: {
  date: string;
  tasks?: { id: string; title: string }[];
  report?: {
    id: string;
    version: number;
    completedText: string;
    remainingText: string;
    blockersText: string;
    taskIds?: string[];
  };
}) {
  return (
    <MutationForm
      endpoint={report ? `/api/v1/reports/${report.id}` : "/api/v1/reports"}
      method={report ? "PATCH" : "POST"}
      label="Save draft"
      transform={(f) => ({
        ...Object.fromEntries(f),
        taskIds: f.getAll("taskIds"),
        ...(report ? { expectedVersion: report.version } : { workDate: date }),
      })}
    >
      {tasks.length > 0 && (
        <fieldset>
          <legend>Linked assignments (optional)</legend>
          {tasks.map((t) => (
            <label className="file-choice" key={t.id}>
              <input
                type="checkbox"
                name="taskIds"
                value={t.id}
                defaultChecked={report?.taskIds?.includes(t.id)}
              />
              {t.title}
            </label>
          ))}
        </fieldset>
      )}
      <TextareaField
        label="Completed work"
        name="completedText"
        defaultValue={report?.completedText}
        maxLength={5000}
      />
      <TextareaField
        label="Remaining work"
        name="remainingText"
        defaultValue={report?.remainingText}
        maxLength={5000}
      />
      <TextareaField
        label="Blockers"
        name="blockersText"
        defaultValue={report?.blockersText}
        maxLength={5000}
      />
    </MutationForm>
  );
}
