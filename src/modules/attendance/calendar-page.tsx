import { calendarData } from "./calendar";
import type { Actor } from "@/server/context";
import { workDate } from "@/lib/dates";
import { PolicyForm, ScheduleAssignmentForm } from "@/components/day-forms";
import {
  ReplaceScheduleForm,
  HolidayForm,
  RemoveHoliday,
} from "@/components/calendar-forms";
export async function CalendarPage({ actor }: { actor: Actor }) {
  const data = await calendarData(actor),
    today = workDate(),
    people = new Map(data.people.map((p) => [p.id, p])),
    policies = new Map(data.policies.map((p) => [p.id, p]));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">COMPANY CALENDAR</span>
          <h1>Schedules</h1>
          <p className="muted">
            Manage staff shifts, effective dates and holidays in Asia/Karachi.
          </p>
        </div>
      </div>
      <div className="split">
        <section className="panel">
          <h2>Create a schedule</h2>
          <PolicyForm />
        </section>
        <section className="panel">
          <h2>Assign a schedule</h2>
          <ScheduleAssignmentForm
            people={data.people.filter(
              (p) => p.status === "ACTIVE" && p.role !== "SUPER_ADMIN",
            )}
            policies={data.policies}
          />
          <p className="note">
            For someone with an existing schedule, use Replace schedule below.
          </p>
        </section>
      </div>
      <section className="panel">
        <h2>Schedule assignments</h2>
        <p className="muted">
          Replace a current or future assignment without overwriting historical
          dates.
        </p>
        {!data.assignments.length && <p>No schedules assigned yet.</p>}
        {data.assignments.map((a) => (
          <article className="revision" key={a.id} data-assignment-id={a.id}>
            <h3>
              {people.get(a.userId)?.displayName ?? "Former staff"} · @
              {people.get(a.userId)?.username}
            </h3>
            <p>
              {policies.get(a.policyId)?.name} ·{" "}
              {a.startDate.toISOString().slice(0, 10)} →{" "}
              {a.endDate?.toISOString().slice(0, 10) ?? "Ongoing"}
            </p>
            {(!a.endDate || a.endDate.toISOString().slice(0, 10) >= today) &&
              people.get(a.userId)?.role !== "SUPER_ADMIN" &&
              people.get(a.userId)?.status === "ACTIVE" && (
                <details>
                  <summary>
                    Replace schedule for @{people.get(a.userId)?.username}
                  </summary>
                  <ReplaceScheduleForm
                    id={a.id}
                    version={a.version}
                    today={today}
                    policies={data.policies}
                    endDate={a.endDate?.toISOString().slice(0, 10) ?? ""}
                  />
                </details>
              )}
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Holidays</h2>
        <HolidayForm today={today} />
        {data.holidays.map((h) => (
          <article className="revision" key={h.id}>
            <h3>
              {h.name} · {h.date.toISOString().slice(0, 10)}
            </h3>
            {h.date.toISOString().slice(0, 10) >= today ? (
              <details>
                <summary>Edit holiday</summary>
                <HolidayForm
                  today={today}
                  item={{ ...h, date: h.date.toISOString().slice(0, 10) }}
                />
                <RemoveHoliday id={h.id} version={h.version} />
              </details>
            ) : (
              <p className="note">Historical holiday retained.</p>
            )}
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>Schedule policies</h2>
        <p className="note">
          Create a new policy when shift rules change; existing snapshots keep
          their original rules.
        </p>
        {data.policies.map((p) => (
          <p key={p.id}>
            <strong>{p.name}</strong> · {p.localStart}–{p.localEnd} ·{" "}
            {p.graceMinutes} min grace
          </p>
        ))}
      </section>
    </>
  );
}
