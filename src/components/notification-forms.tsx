"use client";
import { MutationForm } from "./mutation-form";
export function NotificationPreferences({
  version,
  reportReminders,
}: {
  version: number;
  reportReminders: boolean;
}) {
  return (
    <MutationForm
      endpoint="/api/v1/notification-preferences"
      resetOnSuccess={false}
      label="Save notification preferences"
      transform={(f) => ({
        expectedVersion: version,
        reportReminders: f.get("reportReminders") === "on",
      })}
    >
      <label className="file-choice">
        <input
          name="reportReminders"
          type="checkbox"
          defaultChecked={reportReminders}
        />
        Receive in-app missing-report reminders
      </label>
      <p className="note">
        Company announcements and assignment/review/leave updates stay
        available. Account invitation and password-reset emails are required for
        account access.
      </p>
    </MutationForm>
  );
}
export function ReadAllNotifications() {
  return (
    <MutationForm
      endpoint="/api/v1/notifications/read-all"
      label="Mark all as read"
      transform={() => ({})}
    />
  );
}
