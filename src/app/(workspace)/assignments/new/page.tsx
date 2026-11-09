import Link from "next/link";
import { notFound } from "next/navigation";
import { context } from "@/server/context";
import { db } from "@/server/db";
import { visibleProjects } from "@/modules/projects/service";
import { TaskForm } from "@/components/work-forms";
export default async function NewAssignment() {
  const actor = await context();
  if (!["SUPER_ADMIN", "TEAM_LEAD"].includes(actor.role)) notFound();
  const projects = await db.project.findMany({
    where: {
      ...visibleProjects(actor),
      archivedAt: null,
      ...(actor.role === "TEAM_LEAD" ? { managerId: actor.id } : {}),
    },
    select: {
      id: true,
      name: true,
      members: {
        where: { user: { status: "ACTIVE" } },
        select: {
          user: { select: { id: true, username: true, displayName: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ASSIGNMENTS</span>
          <h1>Assign a task</h1>
          <p className="muted">
            Select a project, an assignee and a different reviewer.
          </p>
        </div>
        <Link className="button" href="/assignments">
          Back to assignments
        </Link>
      </div>
      <section className="panel">
        {projects.length ? (
          <TaskForm
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              people: p.members.map((m) => m.user),
            }))}
          />
        ) : (
          <p>
            Create a project and add its members from{" "}
            <Link href="/projects">Projects</Link> before assigning work.
          </p>
        )}
      </section>
    </>
  );
}
