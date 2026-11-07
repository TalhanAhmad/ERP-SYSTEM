import { context } from "@/server/context";
import { db } from "@/server/db";
import { workDate } from "@/lib/dates";
import { Status } from "@/components/status";
import {
  CheckButton,
  LeaveForm,
  DecisionForm,
  CorrectionForm,
  PolicyForm,
  ScheduleAssignmentForm,
  ReportForm,
} from "@/components/day-forms";
import { hr, attendanceList } from "./service";
import { reports } from "@/modules/reports/service";
export async function DayPage({ section }: { section: string }) {
  const actor = await context();
  const today = workDate();
  const privileged = hr(actor);
  const heading = (title: string, subtitle: string) => (
    <div className="page-heading">
      <div>
        <span className="eyebrow">YOUR COMPANY DAY</span>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
    </div>
  );
  if (section === "attendance") {
    const days = await attendanceList(actor);
    const ownDay = days.find(
      (d) =>
        d.userId === actor.id &&
        d.workDate.toISOString().slice(0, 10) === today,
    );
    return (
      <>
        {heading(
          "Attendance",
          "Server-recorded check events, with a preserved correction history.",
        )}
        <section className="panel">
          <h2>Today · {today}</h2>
          <p className="muted">
            Asia/Karachi · A schedule must be assigned before attendance can be
            recorded.
          </p>
          {ownDay && <Status value={ownDay.status} />}
          <div className="form-actions">
            {!ownDay?.firstIn && <CheckButton kind="in" />}
            {ownDay?.firstIn && !ownDay.lastOut && <CheckButton kind="out" />}
            {ownDay?.lastOut && (
              <span className="success">Your workday is closed.</span>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>{privileged ? "Attendance records" : "My attendance history"}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {privileged && <th>Person ID</th>}
                  <th>Date</th>
                  <th>In / out (Karachi)</th>
                  <th>Gross minutes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.id}>
                    {privileged && <td>{d.userId}</td>}
                    <td>{d.workDate.toISOString().slice(0, 10)}</td>
                    <td>
                      {[d.firstIn, d.lastOut]
                        .map((v) =>
                          v
                            ? new Intl.DateTimeFormat("en-GB", {
                                timeZone: "Asia/Karachi",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(v)
                            : "—",
                        )
                        .join(" / ")}
                    </td>
                    <td>
                      {d.grossMinutes ?? "—"} {d.corrected ? "(corrected)" : ""}
                    </td>
                    <td>
                      <Status value={d.status} />
                      {d.late && <span className="badge">late</span>}
                      {d.early && <span className="badge">early</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!days.length && <p className="empty">No recorded attendance yet.</p>}
          <p className="note">
            Gross elapsed minutes do not deduct breaks and are not payroll
            hours.
          </p>
        </section>
      </>
    );
  }
  if (section === "schedules") {
    if (!privileged) return <p className="error">HR access is required.</p>;
    const policies = await db.schedulePolicy.findMany({
      orderBy: { createdAt: "desc" },
    });
    const people = await db.person.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, username: true },
    });
    return (
      <>
        {heading(
          "Schedules",
          "Define confirmed day-shift policies, then assign effective dates.",
        )}
        <div className="split">
          <section className="panel">
            <h2>Create a schedule</h2>
            <PolicyForm />
          </section>
          <section className="panel">
            <h2>Assign a schedule</h2>
            <ScheduleAssignmentForm people={people} policies={policies} />
          </section>
        </div>
        <section className="panel">
          <h2>Policies</h2>
          {policies.map((p) => (
            <p key={p.id}>
              <strong>{p.name}</strong> · {p.localStart}–{p.localEnd} ·{" "}
              {p.graceMinutes} min grace
            </p>
          ))}
        </section>
      </>
    );
  }
  if (section === "leave") {
    const requests = await db.leaveRequest.findMany({
      where: privileged ? {} : { userId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return (
      <>
        {heading(
          "Leave",
          "Full-day requests, with independent approval and attendance conflict checks.",
        )}
        <section className="panel">
          <details>
            <summary>Request leave</summary>
            <LeaveForm />
          </details>
        </section>
        {requests.map((r) => (
          <section className="panel" key={r.id}>
            <div className="panel-heading">
              <h2>
                {r.startDate.toISOString().slice(0, 10)} →{" "}
                {r.endDate.toISOString().slice(0, 10)}
              </h2>
              <Status value={r.status} />
            </div>
            <p className="muted">
              {r.type} ·{" "}
              {r.userId === actor.id ? "Your request" : `Person ${r.userId}`}
            </p>
            <p className="preline">{r.privateNote}</p>
            <div className="form-actions">
              {r.userId === actor.id && r.status === "PENDING" && (
                <DecisionForm
                  resource="leave"
                  id={r.id}
                  version={r.version}
                  action="cancel"
                />
              )}
              {privileged &&
                r.userId !== actor.id &&
                r.status === "PENDING" && (
                  <>
                    <DecisionForm
                      resource="leave"
                      id={r.id}
                      version={r.version}
                      action="approve"
                    />
                    <DecisionForm
                      resource="leave"
                      id={r.id}
                      version={r.version}
                      action="reject"
                    />
                  </>
                )}
              {privileged &&
                r.userId !== actor.id &&
                r.status === "APPROVED" && (
                  <DecisionForm
                    resource="leave"
                    id={r.id}
                    version={r.version}
                    action="cancel"
                  />
                )}
            </div>
          </section>
        ))}
        {!requests.length && <p className="empty">No leave requests yet.</p>}
      </>
    );
  }
  if (section === "corrections") {
    const own = await db.attendanceDay.findMany({
      where: { userId: actor.id },
      orderBy: { workDate: "desc" },
      take: 100,
    });
    const items = await db.attendanceCorrection.findMany({
      where: privileged ? {} : { requestedBy: actor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return (
      <>
        {heading(
          "Attendance corrections",
          "Request a change while preserving the original check events.",
        )}
        <section className="panel">
          <details>
            <summary>Request a correction</summary>
            <CorrectionForm
              days={own.map((d) => ({
                id: d.id,
                date: d.workDate.toISOString().slice(0, 10),
                version: d.version,
              }))}
            />
          </details>
        </section>
        {items.map((r) => (
          <section className="panel" key={r.id}>
            <div className="panel-heading">
              <h2>
                {r.proposedIn.toISOString()} → {r.proposedOut.toISOString()}
              </h2>
              <Status value={r.status} />
            </div>
            <p className="preline">{r.reason}</p>
            {privileged &&
              actor.id !== r.requestedBy &&
              r.status === "PENDING" && (
                <div className="form-actions">
                  <DecisionForm
                    resource="corrections"
                    id={r.id}
                    version={r.version}
                    action="approve"
                  />
                  <DecisionForm
                    resource="corrections"
                    id={r.id}
                    version={r.version}
                    action="reject"
                  />
                </div>
              )}
          </section>
        ))}
      </>
    );
  }
  const items = await reports(actor);
  const ownToday = items.find(
    (r) =>
      r.userId === actor.id && r.workDate.toISOString().slice(0, 10) === today,
  );
  return (
    <>
      {heading(
        "Daily reports",
        "Share completed work, next steps, and the blockers that need attention.",
      )}
      {!ownToday && (
        <section className="panel">
          <h2>Today’s report · {today}</h2>
          <ReportForm date={today} />
        </section>
      )}
      {items.map((r) => (
        <section className="panel" key={r.id}>
          <div className="panel-heading">
            <h2>
              {r.workDate.toISOString().slice(0, 10)} ·{" "}
              {r.userId === actor.id ? "Your report" : `Person ${r.userId}`}
            </h2>
            <Status value={r.status} />
          </div>
          {r.userId === actor.id && r.status === "DRAFT" ? (
            <ReportForm date={today} report={r} />
          ) : (
            <>
              <h3>Completed work</h3>
              <p className="preline">{r.completedText || "—"}</p>
              <h3>Remaining work</h3>
              <p className="preline">{r.remainingText || "—"}</p>
              <h3>Blockers</h3>
              <p className="preline">{r.blockersText || "—"}</p>
            </>
          )}
          <div className="form-actions">
            {r.userId === actor.id && r.status === "DRAFT" && (
              <DecisionForm
                resource="reports"
                id={r.id}
                version={r.version}
                action="submit"
              />
            )}
            {r.userId !== actor.id && r.status === "SUBMITTED" && (
              <>
                <DecisionForm
                  resource="reports"
                  id={r.id}
                  version={r.version}
                  action="acknowledge"
                />
                <DecisionForm
                  resource="reports"
                  id={r.id}
                  version={r.version}
                  action="return"
                />
              </>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
