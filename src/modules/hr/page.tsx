import { attendanceQuerySchema } from "@/modules/attendance/queries";
import { SelfAttendance } from "@/modules/attendance/self";
import { workDate } from "@/lib/dates";
import Link from "next/link";
import type { Actor } from "@/server/context";
import { hrOverview } from "./service";
import { LiveRefresh } from "@/components/live-refresh";
export async function HrPage({
  actor,
  attendance = false,
  searchParams = {},
}: {
  actor: Actor;
  attendance?: boolean;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const parsed = attendanceQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(searchParams).filter(([key]) =>
        ["date", "status", "q"].includes(key),
      ),
    ),
  );
  const filters = parsed.success
    ? parsed.data
    : attendanceQuerySchema.parse({});
  const data = await hrOverview(actor, filters);
  const time = (value: Date | null) =>
    value
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Karachi",
          hour: "2-digit",
          minute: "2-digit",
        }).format(value)
      : "—";
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PEOPLE AND ATTENDANCE</span>
          <h1>{attendance ? "Attendance" : "HR overview"}</h1>
          <p className="muted">{data.date} · Asia/Karachi</p>
        </div>
        <LiveRefresh />
      </div>
      <div className="stats">
        {[
          [
            "Checked in",
            data.counts.checkedIn,
            `/attendance?date=${data.date}&status=checked-in`,
          ],
          [
            "Checked out",
            data.counts.checkedOut,
            `/attendance?date=${data.date}&status=checked-out`,
          ],
          [
            "Not checked in",
            data.counts.notCheckedIn,
            `/attendance?date=${data.date}&status=not-checked-in`,
          ],
          attendance
            ? [
                "On leave",
                data.counts.onLeave,
                `/attendance?date=${data.date}&status=on-leave`,
              ]
            : ["Pending leave", data.pendingLeaves, "/leave"],
        ].map(([label, count, href]) => (
          <Link className="stat stat-link" key={label} href={String(href)}>
            <div className="stat-top">{label}</div>
            <div className="stat-number">{count}</div>
            <span className="card-action">View list →</span>
          </Link>
        ))}
      </div>
      {attendance && actor.role === "HR_ADMIN" && (
        <SelfAttendance actor={actor} />
      )}
      {attendance && (
        <section className="panel">
          <form action="/attendance" method="GET" className="people-filters">
            <label>
              Attendance date
              <input
                name="date"
                type="date"
                required
                max={workDate()}
                defaultValue={filters.date}
              />
            </label>
            <label>
              Attendance status
              <select name="status" defaultValue={filters.status}>
                <option value="all">All staff</option>
                <option value="checked-in">Checked in</option>
                <option value="checked-out">Checked out</option>
                <option value="not-checked-in">Not checked in</option>
                <option value="on-leave">On leave</option>
              </select>
            </label>
            <label>
              Find a person
              <input name="q" maxLength={100} defaultValue={filters.q} />
            </label>
            <button className="primary">Apply attendance filters</button>
            <Link className="button" href="/attendance">
              Reset filters
            </Link>
          </form>
          {!parsed.success && (
            <p className="error" role="alert">
              Choose a valid date and attendance filters.
            </p>
          )}
        </section>
      )}
      {!attendance && (
        <p className="form-actions">
          <Link className="button primary" href="/attendance">
            View attendance
          </Link>
          <Link className="button" href="/leave">
            Review leave requests
          </Link>
        </p>
      )}
      <section className="panel">
        <h2>Who has checked in?</h2>
        <p className="muted">
          Active staff · Super Admin excluded · updates every 30 seconds
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th>Check in</th>
                <th>Check out</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((person) => (
                <tr key={person.id}>
                  <td>
                    <strong>
                      {person.dayId ? (
                        <Link href={"/attendance/" + person.dayId}>
                          {person.displayName}
                        </Link>
                      ) : (
                        person.displayName
                      )}
                    </strong>
                    <div className="muted">@{person.username}</div>
                  </td>
                  <td>
                    <span className="badge">{person.status}</span>
                    {person.late && <span className="badge">Late</span>}
                    {person.early && <span className="badge">Early</span>}
                  </td>
                  <td>{time(person.firstIn)}</td>
                  <td>{time(person.lastOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.people.length && <p>No active people yet.</p>}
      </section>
    </>
  );
}
