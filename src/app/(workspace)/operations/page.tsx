import { context } from "@/server/context";
import { notFound } from "next/navigation";
import { operationsSnapshot } from "@/server/jobs/monitoring";
import { Status } from "@/components/status";
import { emailTestMode } from "@/lib/email-config";
import {
  QueueAttendanceJob,
  RunJob,
  RefreshJobs,
} from "@/components/job-forms";
export default async function Operations() {
  const actor = await context();
  if (actor.role !== "SUPER_ADMIN") notFound();
  const data = await operationsSnapshot(actor);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ENCOVA WORKSPACE</span>
          <h1>Operations</h1>
          <p className="muted">Attendance processing, progress and recovery.</p>
        </div>
        <RefreshJobs />
      </div>
      <section className="panel">
        <h2>Daily processing</h2>
        <p>
          Attendance for the previous company day is scheduled daily around
          05:15 Karachi time. Hobby scheduling has hourly precision.
        </p>
        <p className="note">
          Progress is saved after each person. Interrupted or partial checks can
          resume below. Schedule registration does not confirm an automatic
          invocation; review attempt history.
        </p>
        {emailTestMode() && (
          <p className="note">
            Personal demo email is restricted to the configured test inbox.
            Other recipients require a verified sending domain.
          </p>
        )}
        <p>
          Last automatic attempt:{" "}
          {data.lastAutomaticAttempt
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Karachi",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(data.lastAutomaticAttempt.startedAt) +
              ` · ${data.lastAutomaticAttempt.status.toLowerCase()}`
            : "None recorded yet"}
          .
        </p>
        <p>
          Email service:{" "}
          <strong>
            {data.email.status === "READY"
              ? "Configured"
              : data.email.status === "INVALID"
                ? "Invalid settings"
                : "Not configured"}
          </strong>
          . {data.email.queued} queued · {data.email.failed} failed emails.
        </p>
        <p className="note">
          SMTP acceptance is separate from inbox delivery. Email bodies and
          tokens are not shown here.
        </p>
      </section>
      <section className="panel">
        <h2>Request attendance reconciliation</h2>
        <p className="note">
          Recheck an individual company date. Corrected attendance and raw
          events are preserved. A completed check records processing at that
          time; it does not close a workday still in progress.
        </p>
        <QueueAttendanceJob
          today={data.today}
          defaultDate={data.previousDate}
        />
      </section>
      <section aria-labelledby="job-history">
        <h2 id="job-history">Recent attendance jobs</h2>
        <p className="note">
          Showing the latest 50 jobs. Each job keeps its captured audience,
          progress and attempt history.
        </p>
        {data.jobs.length === 0 ? (
          <div className="panel">
            <p className="muted">No attendance jobs yet.</p>
          </div>
        ) : (
          data.jobs.map((job) => (
            <article
              className="panel"
              key={job.id}
              aria-label={`Attendance job ${job.id}`}
            >
              <div className="panel-heading">
                <h3>Attendance · {job.workDate.toISOString().slice(0, 10)}</h3>
                <Status value={job.status} />
              </div>
              <p className="preline">{job.reason}</p>
              <p>
                {job.processed} of {job.total} people processed ·{" "}
                {job.updatedCount} records reconciled · {job.attemptCount}{" "}
                attempts
              </p>
              <progress
                value={job.processed}
                max={Math.max(1, job.total)}
                aria-label="Attendance job progress"
              />
              <p className="note">
                Job {job.id} · Version {job.version}
                {job.errorCode ? ` · ${job.errorCode}` : ""}
              </p>
              {job.status === "RUNNING" ? (
                <p className="muted">
                  Processing is running. Refresh to check progress.
                </p>
              ) : job.status !== "SUCCEEDED" ? (
                <RunJob id={job.id} version={job.version} status={job.status} />
              ) : null}
              {job.attempts.length > 0 && (
                <details>
                  <summary>Recent attempts</summary>
                  <ul className="stack">
                    {job.attempts.map((attempt) => (
                      <li key={attempt.id}>
                        <strong>{attempt.status.toLowerCase()}</strong> ·{" "}
                        {attempt.source === "CRON"
                          ? "Schedule"
                          : attempt.source === "ADMIN"
                            ? "Admin"
                            : "Service"}{" "}
                        · {attempt.endCursor - attempt.startCursor} people
                        <br />
                        <span className="preline">{attempt.reason}</span>
                        <br />
                        <span className="note">
                          {attempt.startedAt.toISOString()}
                          {attempt.errorCode ? ` · ${attempt.errorCode}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))
        )}
      </section>
    </>
  );
}
