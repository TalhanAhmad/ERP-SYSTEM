"use client";
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
      <label>
        Private note (optional)
        <textarea name="privateNote" maxLength={2000} />
      </label>
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
      transform={() => ({ expectedVersion: version })}
    />
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
      <label>
        Reason
        <textarea name="reason" required maxLength={2000} />
      </label>
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
        weekdays: String(f.get("weekdays")).split(",").map(Number),
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
          <input type="time" name="localStart" required />
        </label>
        <label>
          Shift ends (Asia/Karachi)
          <input type="time" name="localEnd" required />
        </label>
        <label>
          Weekdays (0=Sun, 1=Mon, … 6=Sat)
          <input
            name="weekdays"
            required
            placeholder="1,2,3,4,5"
            pattern="[0-6](,[0-6])*"
          />
        </label>
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
        Confirm the actual company policy before assigning a schedule. Overnight
        shifts are excluded.
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
}: {
  date: string;
  report?: {
    id: string;
    version: number;
    completedText: string;
    remainingText: string;
    blockersText: string;
  };
}) {
  return (
    <MutationForm
      endpoint={report ? `/api/v1/reports/${report.id}` : "/api/v1/reports"}
      method={report ? "PATCH" : "POST"}
      label="Save draft"
      transform={(f) => ({
        ...Object.fromEntries(f),
        ...(report ? { expectedVersion: report.version } : { workDate: date }),
      })}
    >
      <label>
        Completed work
        <textarea
          name="completedText"
          defaultValue={report?.completedText}
          maxLength={5000}
        />
      </label>
      <label>
        Remaining work
        <textarea
          name="remainingText"
          defaultValue={report?.remainingText}
          maxLength={5000}
        />
      </label>
      <label>
        Blockers
        <textarea
          name="blockersText"
          defaultValue={report?.blockersText}
          maxLength={5000}
        />
      </label>
    </MutationForm>
  );
}
