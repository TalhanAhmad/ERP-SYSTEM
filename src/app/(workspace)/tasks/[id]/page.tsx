import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { context } from "@/server/context";
import { visibleTasks } from "@/modules/tasks/service";
import { Status } from "@/components/status";
import { AttachmentForm } from "@/components/attachment-form";
import { attachmentFields } from "@/modules/attachments/metadata";
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
  const task = await db.task.findFirst({
    where: { id, ...visibleTasks(actor) },
    include: {
      project: true,
      assignee: { select: { displayName: true, username: true } },
      reviewer: { select: { displayName: true, username: true } },
      submissions: {
        orderBy: { revision: "desc" },
        include: { review: true, attachments: { select: attachmentFields } },
      },
    },
  });
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
      <Link className="muted" href="/tasks">
        ← Back to my work
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
                <ReviewForm submissionId={current.id} version={task.version} />
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
    </>
  );
}
