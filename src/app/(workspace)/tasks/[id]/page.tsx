import { taskDetail } from "@/modules/tasks/lifecycle";
import {
  TaskEditForm,
  ReassignForm,
  ReasonAction,
  CommentForm,
} from "@/components/lifecycle-forms";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { context } from "@/server/context";
import { Status } from "@/components/status";
import { AttachmentForm } from "@/components/attachment-form";
import { listDraftAttachments } from "@/modules/attachments/service";
import { storageAvailable } from "@/modules/attachments/storage";
import {
  TransitionForm,
  SubmissionForm,
  ReviewForm,
} from "@/components/work-forms";
export default async function Task({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await context();
  if (actor.role === "HR_ADMIN") notFound();
  const task = await taskDetail(actor, id).catch((e) => {
    if (e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const manage =
    actor.role === "SUPER_ADMIN" ||
    (actor.role === "TEAM_LEAD" && task.project.managerId === actor.id);
  const people = manage
    ? await db.projectMember.findMany({
        where: { projectId: task.projectId, user: { status: "ACTIVE" } },
        select: {
          user: { select: { id: true, username: true, displayName: true } },
        },
      })
    : [];
  if (!task) notFound();
  const own = task.assigneeId === actor.id;
  const reviewer =
    (task.reviewerId === actor.id || actor.role === "SUPER_ADMIN") && !own;
  const current = task.submissions[0];
  const canUpload =
    own &&
    !task.project.archivedAt &&
    ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(task.status);
  const drafts = canUpload ? await listDraftAttachments(actor, id) : [];
  return (
    <>
      <Link className="muted" href="/assignments">
        ← Back to assignments
      </Link>
      <div className="page-heading" style={{ marginTop: 22 }}>
        <div>
          <span className="eyebrow">{task.project.name}</span>
          <h1>{task.title}</h1>
          <p className="muted">
            Assigned to @{task.assignee.username} · Reviewed by @
            {task.reviewer.username}
          </p>
        </div>
        <Status value={task.status} />
      </div>
      <div className="split">
        <div>
          <section className="panel">
            <h2>Instructions</h2>
            <p className="preline">
              {task.description || "No additional instructions."}
            </p>
            <p className="note">
              Priority: {task.priority.toLowerCase()} · Deadline:{" "}
              {task.dueAt?.toISOString() ?? "Not set"} · Version {task.version}
            </p>
          </section>
          <section className="panel">
            <h2>Submission history</h2>
            {task.submissions.length === 0 ? (
              <p className="muted">
                No work submitted yet. Each revision and its feedback will be
                preserved here.
              </p>
            ) : (
              task.submissions.map((s) => (
                <article className="revision" key={s.id}>
                  <strong>Revision {s.revision}</strong>
                  <p>{s.summary}</p>
                  {s.attachments.map((file) => (
                    <div key={file.id}>
                      <a href={`/api/v1/attachments/${file.id}`}>
                        Download {file.fileName} (
                        {Math.ceil(file.byteSize / 1024)} KB)
                      </a>
                    </div>
                  ))}
                  {(s.artifactLinks as string[]).map((url) => (
                    <div key={url}>
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {url}
                      </a>
                    </div>
                  ))}
                  {s.review && (
                    <div className="success">
                      <strong>
                        {s.review.decision === "APPROVE"
                          ? "Approved"
                          : "Changes requested"}
                      </strong>
                      <p>{s.review.feedback || "No additional feedback."}</p>
                    </div>
                  )}
                </article>
              ))
            )}
          </section>
          {canUpload && (
            <AttachmentForm
              taskId={id}
              enabled={storageAvailable()}
              drafts={drafts}
            />
          )}
        </div>
        <section className="panel">
          <h2>Next action</h2>
          {task.project.archivedAt ? (
            <p className="muted">This project is archived and read-only.</p>
          ) : (
            <>
              {own &&
                ["ASSIGNED", "IN_PROGRESS", "BLOCKED"].includes(
                  task.status,
                ) && (
                  <TransitionForm
                    id={id}
                    version={task.version}
                    status={task.status}
                  />
                )}{" "}
              {own &&
                ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(task.status) && (
                  <div style={{ marginTop: 25 }}>
                    <SubmissionForm
                      id={id}
                      version={task.version}
                      attachments={drafts.filter(
                        (file) => file.status === "READY",
                      )}
                    />
                  </div>
                )}
              {reviewer && task.status === "IN_REVIEW" && current && (
                <ReviewForm
                  submissionId={current.id}
                  version={task.version}
                  override={task.reviewerId !== actor.id}
                />
              )}{" "}
              {task.status === "APPROVED" && (
                <div className="success">
                  This assignment is approved. Its submission history is
                  preserved.
                </div>
              )}
              {task.status === "IN_REVIEW" && own && (
                <p className="muted">
                  Your work is waiting for independent review.
                </p>
              )}
              {!own && !reviewer && (
                <p className="muted">
                  You can read this task. Its assignee and designated reviewer
                  manage the next steps.
                </p>
              )}
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>Comments</h2>
        {task.comments.map((c) => (
          <article className="revision" key={c.id}>
            <strong>{c.author?.displayName ?? "Former member"}</strong> ·{" "}
            {c.createdAt.toISOString()}
            <p className="preline">{c.body}</p>
          </article>
        ))}
        {!task.comments.length && <p className="muted">No comments yet.</p>}
        {!task.project.archivedAt &&
          !["APPROVED", "CANCELED"].includes(task.status) && (
            <CommentForm taskId={id} />
          )}
      </section>
      {manage && !task.project.archivedAt && (
        <section className="panel">
          <h2>Manage task</h2>
          {!["APPROVED", "CANCELED", "IN_REVIEW"].includes(task.status) && (
            <>
              <details>
                <summary>Edit task</summary>
                <TaskEditForm
                  task={{ ...task, dueAt: task.dueAt?.toISOString() ?? null }}
                />
              </details>
              <details>
                <summary>Reassign task</summary>
                <ReassignForm task={task} people={people.map((m) => m.user)} />
              </details>
            </>
          )}
          {["APPROVED", "CANCELED"].includes(task.status) ? (
            <details key="reopen">
              <summary>Reopen task</summary>
              <ReasonAction
                endpoint={`/api/v1/tasks/${id}/reopen`}
                version={task.version}
                label="Reopen task"
              />
            </details>
          ) : (
            <details key="cancel">
              <summary>Cancel task</summary>
              <ReasonAction
                endpoint={`/api/v1/tasks/${id}/cancel`}
                version={task.version}
                label="Cancel task"
              />
            </details>
          )}
          {task.status === "IN_REVIEW" && !own && (
            <details>
              <summary>Return for changes</summary>
              <ReasonAction
                endpoint={`/api/v1/tasks/${id}/return`}
                version={task.version}
                label="Return for changes"
              />
            </details>
          )}
        </section>
      )}
    </>
  );
}
