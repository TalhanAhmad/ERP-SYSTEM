import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { context } from "@/server/context";
import { db } from "@/server/db";
import { reportDetail } from "@/modules/reports/service";
import { visibleTasks } from "@/modules/tasks/service";
import { ReportForm, DecisionForm } from "@/components/day-forms";
import { ReasonAction } from "@/components/lifecycle-forms";
import { Status } from "@/components/status";
export default async function Report({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await context(),
    { id } = await params;
  if (actor.role === "HR_ADMIN" || !z.uuid().safeParse(id).success) notFound();
  const item = await reportDetail(actor, id).catch((e) => {
    if (e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const tasks =
    item.userId === actor.id && item.status === "DRAFT"
      ? await db.task.findMany({
          where: { assigneeId: actor.id, ...visibleTasks(actor) },
          select: { id: true, title: true },
          orderBy: { title: "asc" },
        })
      : [];
  return (
    <>
      <Link href="/reports">← Back to reports</Link>
      <div className="page-heading">
        <div>
          <h1>Daily report · {item.workDate.toISOString().slice(0, 10)}</h1>
          <p>
            {item.author.displayName} · @{item.author.username}
          </p>
        </div>
        <Status value={item.status} />
      </div>
      <section className="panel">
        {item.userId === actor.id && item.status === "DRAFT" ? (
          <ReportForm
            date={item.workDate.toISOString().slice(0, 10)}
            report={item}
            tasks={tasks}
          />
        ) : (
          <>
            <h2>Completed work</h2>
            <p className="preline">{item.completedText || "—"}</p>
            <h2>Remaining work</h2>
            <p className="preline">{item.remainingText || "—"}</p>
            <h2>Blockers</h2>
            <p className="preline">{item.blockersText || "—"}</p>
          </>
        )}
        <div className="form-actions">
          {item.userId === actor.id && item.status === "DRAFT" && (
            <DecisionForm
              resource="reports"
              id={id}
              version={item.version}
              action="submit"
            />
          )}
          {item.userId !== actor.id && item.status === "SUBMITTED" && (
            <DecisionForm
              resource="reports"
              id={id}
              version={item.version}
              action="acknowledge"
            />
          )}
        </div>
        {item.userId !== actor.id && item.status === "SUBMITTED" && (
          <details>
            <summary>Return for revision</summary>
            <ReasonAction
              endpoint={"/api/v1/reports/" + id + "/return"}
              version={item.version}
              label="Return report"
            />
          </details>
        )}
        <p className="note">
          {item.cutoffSnapshot
            ? `${item.late ? "Late" : "On time"} against the first-submission cutoff ${item.cutoffSnapshot} Asia/Karachi.`
            : "Submission timing has not been recorded."}
        </p>
      </section>
      <section className="panel">
        <h2>Linked assignments</h2>
        {item.tasks.map((t) => (
          <p key={t.id}>
            <Link href={"/tasks/" + t.id}>{t.title} →</Link>
          </p>
        ))}
        {item.taskIds.length > item.tasks.length && (
          <p>
            Some linked assignments are outside your current project access.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Submission history</h2>
        {item.revisions.map((r) => {
          const content = r.content as {
            completedText?: string;
            remainingText?: string;
            blockersText?: string;
          };
          return (
            <article className="revision" key={r.id}>
              <h3>Report revision · version {r.version}</h3>
              <p className="note">{r.createdAt.toISOString()}</p>
              <h4>Completed work</h4>
              <p className="preline">{content.completedText || "—"}</p>
              <h4>Remaining work</h4>
              <p className="preline">{content.remainingText || "—"}</p>
              <h4>Blockers</h4>
              <p className="preline">{content.blockersText || "—"}</p>
            </article>
          );
        })}
        {!item.revisions.length && <p>No submitted revisions yet.</p>}
      </section>
    </>
  );
}
