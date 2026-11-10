import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { context } from "@/server/context";
import { attendanceDetail } from "@/modules/attendance/detail";
import { Status } from "@/components/status";
import { CorrectionForm, DecisionForm } from "@/components/day-forms";
export default async function AttendanceRecord({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await context(),
    { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const day = await attendanceDetail(actor, id).catch((e) => {
    if (e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const time = (date: Date | null) =>
    date
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Karachi",
          dateStyle: "medium",
          timeStyle: "medium",
        }).format(date)
      : "Not recorded";
  const snapshot = day.snapshot as { start?: string; end?: string };
  return (
    <>
      <Link href="/attendance">← Back to attendance</Link>
      <div className="page-heading">
        <div>
          <h1>Attendance · {day.workDate.toISOString().slice(0, 10)}</h1>
          <p>
            {day.person.displayName} · @{day.person.username}
            {day.person.status !== "ACTIVE" ? " · inactive account" : ""}
          </p>
        </div>
        <Status value={day.status} />
      </div>
      <section className="panel">
        <h2>Effective attendance</h2>
        <p>Check in: {time(day.firstIn)}</p>
        <p>Check out: {time(day.lastOut)}</p>
        <p>
          Gross minutes: {day.grossMinutes ?? "Not recorded"}
          {day.corrected ? " · independently corrected" : ""}
        </p>
        <p>
          Scheduled start:{" "}
          {snapshot.start ? time(new Date(snapshot.start)) : "Not recorded"}
        </p>
        <p>
          Scheduled end:{" "}
          {snapshot.end ? time(new Date(snapshot.end)) : "Not recorded"}
        </p>
        <p className="note">
          Asia/Karachi. Gross elapsed time does not deduct breaks and is not
          payroll time.
        </p>
      </section>
      <section className="panel">
        <h2>Original check events</h2>
        {day.events.map((e) => (
          <p key={e.id}>
            {e.kind === "IN" ? "Check in" : "Check out"} · {time(e.occurredAt)}
          </p>
        ))}
        {!day.events.length && (
          <p>
            No check events were recorded. Reconciliation never fabricates a
            check-out.
          </p>
        )}
      </section>
      {actor.id === day.userId && actor.role !== "SUPER_ADMIN" && (
        <section className="panel">
          <details>
            <summary>Request a correction</summary>
            <CorrectionForm
              days={[
                {
                  id: day.id,
                  date: day.workDate.toISOString().slice(0, 10),
                  version: day.version,
                },
              ]}
            />
          </details>
        </section>
      )}
      {day.corrections.length > 0 && (
        <section className="panel">
          <h2>Correction history</h2>
          {day.corrections.map((c) => (
            <article className="revision" key={c.id}>
              <Status value={c.status} />
              <p className="preline">{c.reason}</p>
              <p>
                Proposed: {time(c.proposedIn)} → {time(c.proposedOut)}
              </p>
              {c.decisionReason && <p>Decision: {c.decisionReason}</p>}
              {actor.role === "SUPER_ADMIN" &&
                c.status === "PENDING" &&
                c.requestedBy !== actor.id && (
                  <div className="form-actions">
                    <DecisionForm
                      resource="corrections"
                      id={c.id}
                      version={c.version}
                      action="approve"
                    />
                    <DecisionForm
                      resource="corrections"
                      id={c.id}
                      version={c.version}
                      action="reject"
                    />
                  </div>
                )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
