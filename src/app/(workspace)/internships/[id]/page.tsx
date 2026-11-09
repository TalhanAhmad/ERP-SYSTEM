import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { context } from "@/server/context";
import {
  internshipDetail,
  internshipOptions,
} from "@/modules/internships/service";
import {
  EnrollmentForm,
  MilestoneForm,
  MilestoneActionForm,
  FeedbackForm,
} from "@/components/internship-forms";
import { Status } from "@/components/status";
export default async function InternshipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await context(),
    { id } = await params;
  if (actor.role === "HR_ADMIN" || !z.uuid().safeParse(id).success) notFound();
  const item = await internshipDetail(actor, id).catch((e) => {
    if (e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const options =
      actor.role === "SUPER_ADMIN" ? await internshipOptions(actor) : null,
    own = actor.id === item.internId,
    canMentor = item.canMentor && !own,
    active = item.status === "ACTIVE" && item.intern?.status === "ACTIVE",
    startDate = item.startDate.toISOString().slice(0, 10),
    endDate = item.endDate.toISOString().slice(0, 10);
  return (
    <>
      <Link href="/internships">← Back to internships</Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LEARNING PLAN</span>
          <h1>{item.intern?.displayName} · internship</h1>
          <p className="muted">
            Mentor: {item.mentor?.displayName} · {item.department?.name} ·{" "}
            {startDate} → {endDate}
          </p>
        </div>
        <Status value={item.status} />
      </div>
      <section className="panel">
        <h2>Learning objective</h2>
        <p className="preline">{item.objective}</p>
        {item.mentor?.status !== "ACTIVE" ||
        !["SUPER_ADMIN", "TEAM_LEAD"].includes(item.mentor?.role ?? "") ? (
          <p className="error">
            An active Team Lead or Super Admin mentor must be assigned before
            independent learning review.
          </p>
        ) : null}
        {options && (
          <details>
            <summary>Edit enrollment</summary>
            <EnrollmentForm
              item={{ ...item, startDate, endDate }}
              options={{
                ...options,
                departments: options.departments.map((d) => ({
                  ...d,
                  archivedAt: d.archivedAt?.toISOString() ?? null,
                })),
              }}
            />
          </details>
        )}
      </section>
      <section className="panel">
        <h2>Learning milestones</h2>
        {active && canMentor && (
          <details>
            <summary>Add a learning milestone</summary>
            <MilestoneForm
              internshipId={id}
              startDate={startDate}
              endDate={endDate}
              tasks={item.taskChoices}
            />
          </details>
        )}
        {item.milestones.map((m) => (
          <article className="revision" key={m.id} data-milestone-id={m.id}>
            <div className="panel-heading">
              <h3>{m.title}</h3>
              <Status value={m.status} />
            </div>
            <p className="preline">{m.description}</p>
            <p className="note">
              Due {m.dueDate.toISOString().slice(0, 10)}
              {m.completedAt
                ? " · Completed " + m.completedAt.toISOString()
                : ""}
            </p>
            {m.tasks.map((t) => (
              <p key={t.id}>
                <Link href={"/tasks/" + t.id}>{t.title} →</Link> ·{" "}
                {t.status.toLowerCase()}
              </p>
            ))}
            {m.taskIds.length > m.tasks.length && (
              <p>Some evidence is outside your current project access.</p>
            )}
            {active &&
              canMentor &&
              ["PLANNED", "ACTIVE"].includes(m.status) && (
                <details>
                  <summary>Edit milestone</summary>
                  <MilestoneForm
                    internshipId={id}
                    startDate={startDate}
                    endDate={endDate}
                    tasks={item.taskChoices}
                    item={{
                      ...m,
                      dueDate: m.dueDate.toISOString().slice(0, 10),
                    }}
                  />
                </details>
              )}
            {active && (
              <div className="stack">
                {canMentor && m.status === "PLANNED" && (
                  <MilestoneActionForm
                    id={m.id}
                    version={m.version}
                    status="ACTIVE"
                    label="Activate milestone"
                  />
                )}
                {own && m.status === "ACTIVE" && (
                  <MilestoneActionForm
                    id={m.id}
                    version={m.version}
                    status="SUBMITTED"
                    label="Submit milestone evidence"
                  />
                )}
                {canMentor && m.status === "SUBMITTED" && (
                  <>
                    <MilestoneActionForm
                      id={m.id}
                      version={m.version}
                      status="COMPLETED"
                      label="Complete milestone"
                      reasonRequired={actor.id !== item.mentorId}
                    />
                    <details>
                      <summary>Return milestone for changes</summary>
                      <MilestoneActionForm
                        id={m.id}
                        version={m.version}
                        status="ACTIVE"
                        label="Return milestone"
                        reasonRequired
                      />
                    </details>
                  </>
                )}
                {canMentor && m.status === "COMPLETED" && (
                  <details>
                    <summary>Reopen milestone</summary>
                    <MilestoneActionForm
                      id={m.id}
                      version={m.version}
                      status="ACTIVE"
                      label="Reopen milestone"
                      reasonRequired
                    />
                  </details>
                )}
              </div>
            )}
          </article>
        ))}
        {!item.milestones.length && (
          <p>The mentor has not added learning milestones yet.</p>
        )}
      </section>
      <section className="panel">
        <h2>Weekly feedback</h2>
        {active && canMentor && (
          <details>
            <summary>Add weekly feedback</summary>
            <FeedbackForm
              internshipId={id}
              override={actor.id !== item.mentorId}
            />
          </details>
        )}
        {item.feedback.map((f) => (
          <article className="revision" key={f.id}>
            <h3>Week of {f.weekStart.toISOString().slice(0, 10)}</h3>
            <h4>Strengths</h4>
            <p className="preline">{f.strengths}</p>
            <h4>Areas to improve</h4>
            <p className="preline">{f.improvements}</p>
            <h4>Next actions</h4>
            <p className="preline">{f.nextActions}</p>
            {f.rating !== null && (
              <p>
                Explained rating: {f.rating}/5 · {f.ratingExplanation}
              </p>
            )}
            {active && canMentor && (
              <details>
                <summary>Edit weekly feedback</summary>
                <FeedbackForm
                  internshipId={id}
                  override={actor.id !== item.mentorId}
                  item={{
                    ...f,
                    weekStart: f.weekStart.toISOString().slice(0, 10),
                  }}
                />
              </details>
            )}
          </article>
        ))}
        {!item.feedback.length && <p>No weekly feedback recorded yet.</p>}
      </section>
    </>
  );
}
