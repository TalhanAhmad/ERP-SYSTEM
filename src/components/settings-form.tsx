"use client";
import { MutationForm } from "./mutation-form";
export function SettingsForm({
  item,
}: {
  item: {
    version: number;
    companyName: string;
    reportCutoff: string;
    workweek: number[];
    policyConfirmedAt: string | null;
    reportReminders: boolean;
  };
}) {
  return (
    <MutationForm
      endpoint="/api/v1/settings"
      label="Save company settings"
      transform={(f) => ({
        expectedVersion: item.version,
        companyName: f.get("companyName"),
        timezone: "Asia/Karachi",
        workweek: f.getAll("workweek").map(Number),
        reportCutoff: f.get("reportCutoff"),
        reportReminders: f.get("reportReminders") === "on",
        confirmPolicies: f.get("confirmPolicies") === "on",
      })}
    >
      <label>
        Company display name
        <input
          name="companyName"
          required
          maxLength={120}
          defaultValue={item.companyName}
        />
      </label>
      <p>Company timezone: Asia/Karachi</p>
      <fieldset>
        <legend>Company workweek</legend>
        {[
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ].map((d, i) => (
          <label className="file-choice" key={d}>
            <input
              type="checkbox"
              name="workweek"
              value={i}
              defaultChecked={item.workweek.includes(i)}
            />
            {d}
          </label>
        ))}
      </fieldset>
      <label>
        Report cutoff (Asia/Karachi)
        <input
          type="time"
          name="reportCutoff"
          required
          defaultValue={item.reportCutoff}
        />
      </label>
      <label className="file-choice">
        <input
          name="reportReminders"
          type="checkbox"
          defaultChecked={item.reportReminders}
        />
        Enable in-app missing-report reminders
      </label>
      <label className="file-choice">
        <input
          name="confirmPolicies"
          type="checkbox"
          defaultChecked={!!item.policyConfirmedAt}
        />
        I have reviewed these settings and the assigned schedule policies as
        actual company policy
      </label>
      <p className="note">
        Unconfirmed values are demo defaults. Changing company settings does not
        rewrite attendance snapshots or assigned shift policies.
      </p>
    </MutationForm>
  );
}
