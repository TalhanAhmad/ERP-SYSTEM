import Link from "next/link";
import type { Actor } from "@/server/context";
import { hrOverview } from "./service";
import { LiveRefresh } from "@/components/live-refresh";
export async function HrPage({
  actor,
  attendance = false,
}: {
  actor: Actor;
  attendance?: boolean;
}) {
  const data = await hrOverview(actor);
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
          ["Checked in", data.counts.checkedIn],
          ["Checked out", data.counts.checkedOut],
          ["Not checked in", data.counts.notCheckedIn],
          ["Pending leave", data.pendingLeaves],
        ].map(([label, count]) => (
          <section className="stat" key={label}>
            <div className="stat-top">{label}</div>
            <div className="stat-number">{count}</div>
          </section>
        ))}
      </div>
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
        <p className="muted">Active people · updates every 30 seconds</p>
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
                    <strong>{person.displayName}</strong>
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
