"use client";
import { TextareaField } from "./textarea-field";
import { MutationForm } from "./mutation-form";
export function ReplaceScheduleForm({
  id,
  version,
  policies,
  today,
  endDate,
}: {
  id: string;
  version: number;
  policies: { id: string; name: string }[];
  today: string;
  endDate: string;
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/schedule-assignments/${id}/replace`}
      label="Replace schedule"
      transform={(f) => ({
        expectedVersion: version,
        policyId: f.get("policyId"),
        effectiveDate: f.get("effectiveDate"),
        ...(f.get("endDate") ? { endDate: f.get("endDate") } : {}),
        reason: f.get("reason"),
      })}
    >
      <div className="form-grid">
        <label>
          New schedule
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
          Replace from
          <input type="date" name="effectiveDate" min={today} required />
        </label>
        <label>
          Replacement end (optional)
          <input
            type="date"
            name="endDate"
            min={today}
            defaultValue={endDate}
          />
        </label>
      </div>
      <TextareaField
        label="Reason for schedule change"
        name="reason"
        required
        maxLength={1000}
      />
      <p className="note">
        Earlier dates keep their original schedule. Blank end keeps the existing
        end. Recorded attendance and reserved leave block changes in the
        affected range.
      </p>
    </MutationForm>
  );
}
export function HolidayForm({
  today,
  item,
}: {
  today: string;
  item?: { id: string; version: number; name: string; date: string };
}) {
  return (
    <MutationForm
      endpoint={item ? "/api/v1/holidays/" + item.id : "/api/v1/holidays"}
      method={item ? "PATCH" : "POST"}
      label={item ? "Save holiday" : "Add holiday"}
      transform={(f) => ({
        ...Object.fromEntries(f),
        ...(item ? { expectedVersion: item.version } : {}),
      })}
    >
      <div className="form-grid">
        <label>
          Holiday name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={item?.name}
          />
        </label>
        <label>
          Holiday date
          <input
            name="date"
            type="date"
            required
            min={item?.date ?? today}
            defaultValue={item?.date}
          />
        </label>
      </div>
    </MutationForm>
  );
}
export function RemoveHoliday({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  return (
    <MutationForm
      endpoint={"/api/v1/holidays/" + id + "/remove"}
      label="Remove holiday"
      transform={() => ({ expectedVersion: version })}
    >
      <label className="file-choice">
        <input type="checkbox" required />
        Confirm removing this holiday from the future work calendar
      </label>
    </MutationForm>
  );
}
