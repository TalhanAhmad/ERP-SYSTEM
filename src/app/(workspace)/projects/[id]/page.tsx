import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { context } from "@/server/context";
import { projectDetail } from "@/modules/projects/lifecycle";
import { Status } from "@/components/status";
import { MemberForm } from "@/components/work-forms";
import {
  ProjectEditForm,
  ReasonAction,
  RemoveMember,
} from "@/components/lifecycle-forms";
import { db } from "@/server/db";
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await context();
  if (actor.role === "HR_ADMIN") notFound();
  const p = await projectDetail(actor, id).catch((e) => {
    if (e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const manage =
    actor.role === "SUPER_ADMIN" ||
    (actor.role === "TEAM_LEAD" && p.managerId === actor.id);
  const people =
    manage && !p.archivedAt
      ? await db.person.findMany({
          where: {
            status: "ACTIVE",
            ...(actor.role === "TEAM_LEAD"
              ? {
                  OR: [
                    { id: actor.id },
                    {
                      memberships: {
                        some: { project: { managerId: actor.id } },
                      },
                    },
                  ],
                }
              : {}),
          },
          select: { id: true, username: true, displayName: true },
          orderBy: { username: "asc" },
        })
      : [];
  return (
    <>
      <Link href="/projects">← Back to projects</Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT</span>
          <h1>{p.name}</h1>
          <p className="muted">{p.description || "No description provided."}</p>
        </div>
        <Status value={p.archivedAt ? "ARCHIVED" : "ACTIVE"} />
      </div>
      <p>
        <Link className="button primary" href={"/assignments?project=" + p.id}>
          View project assignments →
        </Link>
      </p>
      <section className="panel">
        <h2>Project members</h2>
        {p.members.map((m) => (
          <article className="revision" key={m.userId}>
            <strong>{m.user.displayName}</strong> · @{m.user.username} ·{" "}
            {m.user.status.toLowerCase()}
            {m.userId === p.managerId && " · project manager"}
            {manage && !p.archivedAt && m.userId !== p.managerId && (
              <details>
                <summary>Remove @{m.user.username}</summary>
                <RemoveMember
                  projectId={p.id}
                  userId={m.userId}
                  version={p.version}
                />
              </details>
            )}
          </article>
        ))}
        {manage && !p.archivedAt && (
          <details>
            <summary>Add a project member</summary>
            <MemberForm projectId={p.id} people={people} />
          </details>
        )}
      </section>
      {manage && (
        <section className="panel">
          <h2>Manage project</h2>
          {!p.archivedAt && (
            <details>
              <summary>Edit project</summary>
              <ProjectEditForm project={p} />
            </details>
          )}
          <details key={p.archivedAt ? "restore" : "archive"}>
            <summary>
              {p.archivedAt ? "Restore project" : "Archive project"}
            </summary>
            <ReasonAction
              endpoint={`/api/v1/projects/${p.id}/${p.archivedAt ? "restore" : "archive"}`}
              version={p.version}
              label={p.archivedAt ? "Restore project" : "Archive project"}
              cancelOpen={!p.archivedAt}
            />
          </details>
          <p className="note">
            Archive preserves submissions, comments, membership and audit
            history. Restore does not reopen canceled tasks automatically.
          </p>
        </section>
      )}
    </>
  );
}
