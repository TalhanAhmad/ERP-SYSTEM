import Link from "next/link";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { ProjectForm, MemberForm } from "@/components/work-forms";
import { Status } from "@/components/status";
import { projectDirectory } from "./service";
import { projectQuerySchema } from "./queries";
export async function ProjectsPage({
  actor,
  searchParams,
}: {
  actor: Actor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const parsed = projectQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(searchParams).filter(([key]) =>
        ["status", "q", "page"].includes(key),
      ),
    ),
  );
  const query = parsed.success ? parsed.data : projectQuerySchema.parse({});
  const data = await projectDirectory(actor, query),
    manage = ["SUPER_ADMIN", "TEAM_LEAD"].includes(actor.role);
  const people = manage
    ? await db.person.findMany({
        where: {
          status: "ACTIVE",
          ...(actor.role === "TEAM_LEAD"
            ? {
                OR: [
                  { id: actor.id },
                  {
                    memberships: { some: { project: { managerId: actor.id } } },
                  },
                ],
              }
            : {}),
        },
        select: { id: true, displayName: true, username: true },
        orderBy: { username: "asc" },
      })
    : [];
  const href = (page: number) =>
    "/projects?" + new URLSearchParams({ ...query, page: String(page) });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE PROJECTS</span>
          <h1>Projects</h1>
          <p className="muted">
            Bring the right people together around meaningful work.
          </p>
        </div>
      </div>
      <section className="panel">
        <form action="/projects" method="GET" className="people-filters">
          <label>
            Project status
            <select name="status" defaultValue={query.status}>
              <option value="active">Active projects</option>
              <option value="archived">Archived projects</option>
              <option value="all">All projects</option>
            </select>
          </label>
          <label>
            Search projects
            <input name="q" maxLength={100} defaultValue={query.q} />
          </label>
          <button className="primary">Apply filters</button>
          <Link className="button" href="/projects">
            Reset filters
          </Link>
        </form>
        {!parsed.success && (
          <p className="error" role="alert">
            Choose valid project filters.
          </p>
        )}
      </section>
      {manage && (
        <section className="panel">
          <details>
            <summary>Create a project</summary>
            <ProjectForm />
          </details>
        </section>
      )}
      <p className="muted">{data.total} projects</p>
      {data.items.map((p) => (
        <section className="panel" key={p.id}>
          <div className="panel-heading">
            <h2>{p.name}</h2>
            <Status value={p.archivedAt ? "ARCHIVED" : "ACTIVE"} />
          </div>
          <p className="muted">{p.description || "No description provided."}</p>
          <p className="note">
            {p._count.members} members · {p._count.tasks} tasks
          </p>
          <p>
            <Link className="button" href={"/assignments?project=" + p.id}>
              View assignments →
            </Link>
          </p>
          {!p.archivedAt &&
            (actor.role === "SUPER_ADMIN" ||
              (actor.role === "TEAM_LEAD" && p.managerId === actor.id)) && (
              <details>
                <summary>Add a project member</summary>
                <MemberForm projectId={p.id} people={people} />
              </details>
            )}
        </section>
      ))}
      {!data.items.length && (
        <p className="empty">No projects match these filters.</p>
      )}
      <nav className="form-actions" aria-label="Project pages">
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
    </>
  );
}
