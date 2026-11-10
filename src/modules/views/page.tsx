import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { visibleProjects } from "@/modules/projects/service";
import { workDate } from "@/lib/dates";
import { tableData, savedViews, savedView } from "./service";
import { tableQuerySchema, tableRegistry, type TableEntity } from "./queries";
import { StructuredTable } from "@/components/structured-table";
import { CsvTaskImport } from "@/components/task-changes";
export async function TablesPage({
  actor,
  searchParams,
}: {
  actor: Actor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  if (actor.role === "HR_ADMIN") notFound();
  let current: Awaited<ReturnType<typeof savedView>> | undefined;
  const raw = Object.fromEntries(
    Object.entries(searchParams).filter(([k]) =>
      [
        "entity",
        "q",
        "status",
        "project",
        "date",
        "sort",
        "order",
        "role",
        "peopleStatus",
        "view",
        "deadline",
        "page",
      ].includes(k),
    ),
  );
  if (typeof searchParams.saved === "string") {
    if (!z.uuid().safeParse(searchParams.saved).success) notFound();
    current = await savedView(actor, searchParams.saved).catch((e) => {
      if (e.code === "NOT_FOUND") notFound();
      throw e;
    });
  }
  const parsed = tableQuerySchema.safeParse(current?.filters ?? raw),
    query = parsed.success ? parsed.data : tableQuerySchema.parse({});
  const [data, views, projects] = await Promise.all([
    tableData(actor, query),
    savedViews(actor, query.entity),
    db.project.findMany({
      where: visibleProjects(actor),
      select: { id: true, name: true, managerId: true, archivedAt: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const key = JSON.stringify({
      ...query,
      page: undefined,
      savedId: current?.id,
      savedVersion: current?.version,
    }),
    columns = current?.columns ?? tableRegistry[query.entity].defaults;
  const canManage = ["SUPER_ADMIN", "TEAM_LEAD"].includes(actor.role);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">STRUCTURED WORKSPACE TABLES</span>
          <h1>{tableRegistry[query.entity].title} table</h1>
          <p className="muted">
            Typed filters, personal views and guarded edits over the same
            workspace records.
          </p>
        </div>
      </div>
      <nav className="form-actions" aria-label="Table selection">
        {Object.entries(tableRegistry).map(([entity, config]) => (
          <Link
            className="button"
            aria-current={entity === query.entity ? "page" : undefined}
            key={entity}
            href={"/tables?entity=" + entity}
          >
            {config.title}
          </Link>
        ))}
      </nav>
      <section className="panel">
        <form action="/tables" method="GET" className="people-filters">
          <input type="hidden" name="entity" value={query.entity} />
          <label>
            Search table
            <input name="q" maxLength={100} defaultValue={query.q} />
          </label>
          <label>
            Table status
            <select name="status" defaultValue={query.status}>
              {tableRegistry[query.entity].statuses.map((s) => (
                <option value={s} key={s}>
                  {s === "all" ? "All statuses" : s.replaceAll("-", " ")}
                </option>
              ))}
            </select>
          </label>
          {["attendance", "report-status"].includes(query.entity) && (
            <label>
              Work date
              <input
                name="date"
                type="date"
                required
                max={workDate()}
                defaultValue={query.date}
              />
            </label>
          )}
          {query.entity === "tasks" && (
            <>
              <label>
                Project filter
                <select name="project" defaultValue={query.project}>
                  <option value="">All accessible projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.archivedAt ? " (archived)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Deadline filter
                <select name="deadline" defaultValue={query.deadline}>
                  <option value="all">All deadlines</option>
                  <option value="overdue">Overdue open tasks</option>
                </select>
              </label>
              <label>
                Assignment view
                <select name="view" defaultValue={query.view}>
                  {["all", "open", "review", "approved"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {query.entity === "people" && (
            <label>
              Role filter
              <select name="role" defaultValue={query.role}>
                {["all", "SUPER_ADMIN", "HR_ADMIN", "TEAM_LEAD", "MEMBER"].map(
                  (r) => (
                    <option key={r}>{r}</option>
                  ),
                )}
              </select>
            </label>
          )}
          {query.entity === "attendance" && actor.role === "SUPER_ADMIN" && (
            <label>
              Staff inclusion
              <select name="peopleStatus" defaultValue={query.peopleStatus}>
                <option>ACTIVE</option>
                <option>INACTIVE</option>
                <option>ALL</option>
              </select>
            </label>
          )}
          <label>
            Sort column
            <select name="sort" defaultValue={query.sort}>
              <option value="default">Default sort</option>
              {tableRegistry[query.entity].sorts.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Sort order
            <select name="order" defaultValue={query.order}>
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <button className="primary">Apply table filters</button>
          <Link className="button" href={"/tables?entity=" + query.entity}>
            Reset filters
          </Link>
        </form>
        {!parsed.success && (
          <p className="error" role="alert">
            Choose valid columns, dates and filters for this table.
          </p>
        )}
      </section>
      <StructuredTable
        key={key}
        entity={query.entity as TableEntity}
        query={query}
        rows={data.rows}
        total={data.total}
        page={data.page}
        pages={data.pages}
        columns={data.columns}
        initialColumns={columns}
        views={views}
        currentView={
          current
            ? { id: current.id, version: current.version, name: current.name }
            : undefined
        }
        canManage={canManage}
      />
      {query.entity === "tasks" && canManage && (
        <CsvTaskImport
          projects={projects.filter(
            (p) =>
              !p.archivedAt &&
              (actor.role === "SUPER_ADMIN" || p.managerId === actor.id),
          )}
        />
      )}
    </>
  );
}
