import Link from "next/link";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { workDate } from "@/lib/dates";
import { ReportForm } from "@/components/day-forms";
import { Status } from "@/components/status";
import { visibleTasks } from "@/modules/tasks/service";
import {
  reportDirectory,
  reportListQuery,
  reportStatusDirectory,
  reportStatusQuery,
} from "./status";
export async function ReportsPage({
  actor,
  searchParams,
}: {
  actor: Actor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const parsed = reportListQuery.safeParse(
      Object.fromEntries(
        Object.entries(searchParams).filter(([k]) =>
          ["date", "status", "page"].includes(k),
        ),
      ),
    ),
    query = parsed.success ? parsed.data : reportListQuery.parse({}),
    data = await reportDirectory(actor, query),
    date = query.date || workDate();
  const [own, tasks] = await Promise.all([
    db.dailyReport.findUnique({
      where: {
        userId_workDate: { userId: actor.id, workDate: new Date(date) },
      },
    }),
    db.task.findMany({
      where: { assigneeId: actor.id, ...visibleTasks(actor) },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);
  const href = (page: number) =>
    "/reports?" + new URLSearchParams({ ...query, page: String(page) });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DAILY PROGRESS</span>
          <h1>Daily reports</h1>
          <p className="muted">
            Draft, submit and independently review daily updates.
          </p>
        </div>
        <Link className="button" href="/report-status">
          View report status →
        </Link>
      </div>
      <section className="panel">
        <form action="/reports" method="GET" className="people-filters">
          <label>
            Report date
            <input
              type="date"
              name="date"
              max={workDate()}
              defaultValue={query.date}
            />
          </label>
          <label>
            Report status
            <select name="status" defaultValue={query.status}>
              <option value="all">All reports</option>
              <option>DRAFT</option>
              <option>SUBMITTED</option>
              <option>ACKNOWLEDGED</option>
            </select>
          </label>
          <button className="primary">Apply filters</button>
          <Link className="button" href="/reports">
            Reset filters
          </Link>
        </form>
        {!parsed.success && (
          <p className="error">Choose valid report filters.</p>
        )}
      </section>
      {!own && date <= workDate() && (
        <section className="panel">
          <h2>Write your report · {date}</h2>
          <ReportForm date={date} tasks={tasks} />
        </section>
      )}
      {own && (
        <p>
          <Link className="button primary" href={"/reports/" + own.id}>
            Open your report for {date} →
          </Link>
        </p>
      )}
      <section className="panel">
        <h2>{data.total} reports</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date / person</th>
                <th>Status</th>
                <th>Timing</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.workDate.toISOString().slice(0, 10)}
                    <div className="muted">
                      {r.author?.displayName} · @{r.author?.username}
                    </div>
                  </td>
                  <td>
                    <Status value={r.status} />
                  </td>
                  <td>
                    {!r.cutoffSnapshot
                      ? "Not recorded"
                      : r.late
                        ? "Late"
                        : "On time"}
                  </td>
                  <td>
                    <Link href={"/reports/" + r.id}>Open report →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.items.length && <p>No reports match these filters.</p>}
        <nav aria-label="Report pages" className="form-actions">
          {data.page > 1 && (
            <Link className="button" href={href(data.page - 1)}>
              Previous
            </Link>
          )}
          <span>
            Page {data.page} of {data.pages}
          </span>
          {data.page < data.pages && (
            <Link className="button" href={href(data.page + 1)}>
              Next
            </Link>
          )}
        </nav>
      </section>
    </>
  );
}
export async function ReportStatusPage({
  actor,
  searchParams,
}: {
  actor: Actor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const parsed = reportStatusQuery.safeParse(
      Object.fromEntries(
        Object.entries(searchParams).filter(([k]) =>
          ["date", "status", "q", "page"].includes(k),
        ),
      ),
    ),
    query = parsed.success ? parsed.data : reportStatusQuery.parse({}),
    data = await reportStatusDirectory(actor, query);
  const href = (page: number) =>
    "/report-status?" + new URLSearchParams({ ...query, page: String(page) });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Report status</h1>
          <p className="muted">
            Scheduled workdays only · holidays and approved leave are excused.
          </p>
        </div>
      </div>
      <div className="stats">
        {[
          ["Missing reports", data.counts.missing, "missing"],
          ["Submitted reports", data.counts.submitted, "submitted"],
          ["Not due yet", data.counts.notDue, "not-due"],
        ].map(([label, count, status]) => (
          <Link
            className="stat stat-link"
            key={label}
            href={
              "/report-status?" +
              new URLSearchParams({ date: query.date, status: String(status) })
            }
          >
            <div className="stat-top">{label}</div>
            <div className="stat-number">{count}</div>
          </Link>
        ))}
      </div>
      <section className="panel">
        <form action="/report-status" method="GET" className="people-filters">
          <label>
            Work date
            <input
              type="date"
              name="date"
              required
              max={workDate()}
              defaultValue={query.date}
            />
          </label>
          <label>
            Status filter
            <select name="status" defaultValue={query.status}>
              {[
                "all",
                "missing",
                "not-due",
                "submitted",
                "acknowledged",
                "draft",
                "excused",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Find a person
            <input name="q" maxLength={100} defaultValue={query.q} />
          </label>
          <button className="primary">Apply filters</button>
        </form>
        {!parsed.success && (
          <p className="error">Choose valid report-status filters.</p>
        )}
      </section>
      <section className="panel">
        <h2>{data.total} people</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th>Calendar / cutoff</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.displayName}
                    <div className="muted">@{p.username}</div>
                  </td>
                  <td>
                    {p.status.replaceAll("-", " ")}
                    {p.late && " · late"}
                  </td>
                  <td>
                    {p.reason}
                    <div className="note">
                      {new Intl.DateTimeFormat("en-GB", {
                        timeZone: "Asia/Karachi",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(p.cutoff))}{" "}
                      Karachi
                    </div>
                  </td>
                  <td>
                    {p.reportId ? (
                      <Link href={"/reports/" + p.reportId}>Open report →</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav aria-label="Report status pages" className="form-actions">
          {data.page > 1 && (
            <Link className="button" href={href(data.page - 1)}>
              Previous
            </Link>
          )}
          <span>
            Page {data.page} of {data.pages}
          </span>
          {data.page < data.pages && (
            <Link className="button" href={href(data.page + 1)}>
              Next
            </Link>
          )}
        </nav>
      </section>
    </>
  );
}
