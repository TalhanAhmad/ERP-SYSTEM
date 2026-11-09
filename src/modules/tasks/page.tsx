import Link from "next/link";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { visibleProjects } from "@/modules/projects/service";
import { Status } from "@/components/status";
import { listAssignments } from "./service";
import { assignmentQuerySchema } from "./queries";
export async function AssignmentsPage({
  actor,
  searchParams,
}: {
  actor: Actor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const parsed = assignmentQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(searchParams).filter(([key]) =>
        ["view", "q", "project", "page"].includes(key),
      ),
    ),
  );
  const query = parsed.success ? parsed.data : assignmentQuerySchema.parse({});
  const [data, projects] = await Promise.all([
    listAssignments(actor, query),
    db.project.findMany({
      where: visibleProjects(actor),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const href = (page: number) =>
    "/assignments?" + new URLSearchParams({ ...query, page: String(page) });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PLAN, ASSIGN, REVIEW</span>
          <h1>Assignments</h1>
          <p className="muted">
            Follow work from assignment to independent approval.
          </p>
        </div>
        {["SUPER_ADMIN", "TEAM_LEAD"].includes(actor.role) && (
          <Link href="/assignments/new" className="button primary">
            Assign a task
          </Link>
        )}
      </div>
      <section className="panel">
        <form action="/assignments" method="GET" className="people-filters">
          <label>
            Assignment view
            <select name="view" defaultValue={query.view}>
              <option value="all">All assignments</option>
              <option value="open">Open assignments</option>
              <option value="review">Awaiting review</option>
              <option value="approved">Approved work</option>
            </select>
          </label>
          <label>
            Project filter
            <select name="project" defaultValue={query.project}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search assignments
            <input
              name="q"
              maxLength={100}
              defaultValue={query.q}
              placeholder="Task, project or assignee"
            />
          </label>
          <button className="primary">Apply filters</button>
          <Link className="button" href="/assignments">
            Reset filters
          </Link>
        </form>
        {!parsed.success && (
          <p className="error" role="alert">
            Choose valid assignment filters.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            {
              {
                all: "All assignments",
                open: "Open assignments",
                review: "Awaiting review",
                approved: "Approved work",
              }[query.view]
            }
          </h2>
          <span>{data.total} assignments</span>
        </div>
        {query.view === "review" && (
          <p className="note">
            {actor.role === "SUPER_ADMIN"
              ? "All pending reviews across the workspace."
              : "Work waiting for your independent review."}
          </p>
        )}
        {data.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task / project</th>
                  <th>Assignee</th>
                  <th>Reviewer</th>
                  <th>Status</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={"/tasks/" + t.id}>
                        <strong>{t.title}</strong>
                      </Link>
                      <div className="muted">{t.project.name}</div>
                    </td>
                    <td>@{t.assignee.username}</td>
                    <td>@{t.reviewer.username}</td>
                    <td>
                      <Status value={t.status} />
                    </td>
                    <td>{t.priority.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No assignments match these filters.</p>
        )}
        <nav className="form-actions" aria-label="Assignment pages">
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
      </section>
    </>
  );
}
