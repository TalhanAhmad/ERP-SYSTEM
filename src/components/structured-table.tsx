"use client";
import Link from "next/link";
import { useState } from "react";
import type { GridRow } from "@/modules/views/service";
import {
  tableRegistry,
  type TableQuery,
  type TableEntity,
} from "@/modules/views/queries";
import { MutationForm } from "./mutation-form";
import { BulkTaskChanges } from "./task-changes";
function InlineEditor({ row, field }: { row: GridRow; field: string }) {
  if (row.person)
    return (
      <MutationForm
        endpoint={"/api/v1/users/" + row.id}
        method="PATCH"
        label="Save cell"
        transform={(f) => ({
          ...row.person,
          [field === "name" ? "displayName" : field]: f.get("value"),
          expectedVersion: row.person!.version,
          id: undefined,
          version: undefined,
        })}
      >
        <label>
          New {field}
          {field === "employmentType" ? (
            <select name="value" defaultValue={String(row.values[field] ?? "")}>
              <option>EMPLOYEE</option>
              <option>INTERN</option>
            </select>
          ) : (
            <input
              name="value"
              required
              maxLength={field === "username" ? 30 : 120}
              defaultValue={
                field === "username"
                  ? row.person.username
                  : String(row.values[field] ?? "")
              }
            />
          )}
        </label>
      </MutationForm>
    );
  if (row.task)
    return (
      <MutationForm
        endpoint={"/api/v1/tasks/" + row.id}
        method="PATCH"
        label="Save cell"
        transform={(f) => ({
          title: row.task!.title,
          description: row.task!.description,
          priority: row.task!.priority,
          dueAt: row.task!.dueAt,
          [field]:
            field === "dueAt"
              ? f.get("value")
                ? new Date(String(f.get("value")) + ":00+05:00").toISOString()
                : null
              : f.get("value"),
          expectedVersion: row.task!.version,
        })}
      >
        <label>
          New {field}
          {field === "priority" ? (
            <select name="value" defaultValue={row.task.priority}>
              {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          ) : (
            <input
              name="value"
              type={field === "dueAt" ? "datetime-local" : "text"}
              required={field !== "dueAt"}
              maxLength={200}
              defaultValue={
                field === "dueAt"
                  ? row.task.dueAt
                    ? new Date(Date.parse(row.task.dueAt) + 5 * 3600000)
                        .toISOString()
                        .slice(0, 16)
                    : ""
                  : String(row.values[field] ?? "")
              }
            />
          )}
        </label>
      </MutationForm>
    );
  return null;
}
export function StructuredTable({
  entity,
  query,
  rows,
  total,
  page,
  pages,
  columns,
  initialColumns,
  views,
  currentView,
  canManage,
}: {
  entity: TableEntity;
  query: TableQuery;
  rows: GridRow[];
  total: number;
  page: number;
  pages: number;
  columns: string[];
  initialColumns: string[];
  views: { id: string; name: string; version: number }[];
  currentView?: { id: string; version: number; name: string };
  canManage: boolean;
}) {
  const [visible, setVisible] = useState(
      initialColumns.filter((c) => columns.includes(c)),
    ),
    [selected, setSelected] = useState<
      Record<string, { id: string; expectedVersion: number }>
    >({}),
    [message, setMessage] = useState("");
  const labels = tableRegistry[entity].columns as Record<string, string>,
    selectedItems = Object.values(selected),
    selectable = entity === "tasks" && canManage,
    eligible = rows.filter((r) => r.canEdit && r.task),
    all = eligible.length > 0 && eligible.every((r) => !!selected[r.id]);
  const href = (extra: Partial<TableQuery> = {}) =>
    "/tables?" +
    new URLSearchParams(
      Object.entries({ ...query, ...extra }).map(([k, v]) => [k, String(v)]),
    );
  const exportHref =
    "/api/v1/exports?" +
    new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(query).map(([k, v]) => [k, String(v)]),
      ),
      columns: visible.join(","),
    });
  return (
    <>
      <section className="panel">
        <details>
          <summary>Columns and personal saved views</summary>
          <fieldset>
            <legend>Visible columns</legend>
            <div className="column-choices">
              {columns.map((c) => (
                <label className="file-choice" key={c}>
                  <input
                    type="checkbox"
                    checked={visible.includes(c)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...visible, c]
                        : visible.filter((v) => v !== c);
                      if (next.length) setVisible(next);
                      else setMessage("Keep at least one column visible.");
                    }}
                  />
                  {labels[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form-actions">
            {views.map((v) => (
              <Link
                className="button"
                key={v.id}
                href={"/tables?saved=" + v.id}
              >
                {v.name}
              </Link>
            ))}
          </div>
          <MutationForm
            endpoint={
              currentView
                ? "/api/v1/saved-views/" + currentView.id
                : "/api/v1/saved-views"
            }
            label={currentView ? "Update personal view" : "Save personal view"}
            resetOnSuccess={!currentView}
            transform={(f) => ({
              expectedVersion: currentView?.version ?? 0,
              entity,
              name: f.get("name"),
              columns: visible,
              filters: { ...query, page: 1 },
            })}
          >
            <label>
              Personal view name
              <input
                name="name"
                required
                maxLength={60}
                defaultValue={currentView?.name}
              />
            </label>
          </MutationForm>
          {currentView && (
            <MutationForm
              endpoint={"/api/v1/saved-views/" + currentView.id + "/remove"}
              label="Delete personal view"
              redirectTo={"/tables?entity=" + entity}
              transform={() => ({ expectedVersion: currentView.version })}
            >
              <label className="file-choice">
                <input type="checkbox" required />
                Confirm deleting your saved view
              </label>
            </MutationForm>
          )}
        </details>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>{total} records</h2>
          <a className="button" href={exportHref}>
            Export filtered CSV
          </a>
        </div>
        <p className="note">
          Use arrow keys, Home and End to move through cells. Tab reaches links
          and edit controls. Attendance cells open the correction/view workflow;
          recorded values cannot be overwritten here.
        </p>
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {selectable && (
          <div className="form-actions">
            <span>{selectedItems.length} of at most 100 tasks selected</span>
            <button type="button" onClick={() => setSelected({})}>
              Clear selection
            </button>
          </div>
        )}
        <div className="table-wrap">
          <table
            role="grid"
            tabIndex={0}
            aria-label={tableRegistry[entity].title + " structured table"}
            aria-rowcount={total + 1}
            aria-colcount={visible.length + 1 + (selectable ? 1 : 0)}
            onKeyDown={(e) => {
              if (
                ![
                  "ArrowUp",
                  "ArrowDown",
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                ].includes(e.key) ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(
                  (e.target as HTMLElement).tagName,
                )
              )
                return;
              const table = e.currentTarget,
                cell = (e.target as HTMLElement).closest(
                  "td,th",
                ) as HTMLTableCellElement | null,
                r = cell
                  ? (cell.parentElement as HTMLTableRowElement).rowIndex
                  : 0,
                c = cell?.cellIndex ?? 0;
              let nr = r,
                nc = c;
              if (e.key === "ArrowUp") nr--;
              if (e.key === "ArrowDown") nr++;
              if (e.key === "ArrowLeft") nc--;
              if (e.key === "ArrowRight") nc++;
              if (e.key === "Home") {
                nc = 0;
                if (e.ctrlKey) nr = 0;
              }
              if (e.key === "End") {
                if (e.ctrlKey) nr = table.rows.length - 1;
                nc =
                  table.rows[Math.max(0, Math.min(nr, table.rows.length - 1))]
                    .cells.length - 1;
              }
              nr = Math.max(0, Math.min(nr, table.rows.length - 1));
              nc = Math.max(0, Math.min(nc, table.rows[nr].cells.length - 1));
              e.preventDefault();
              table.rows[nr].cells[nc].focus();
            }}
          >
            <thead>
              <tr aria-rowindex={1}>
                {selectable && (
                  <th scope="col" tabIndex={-1}>
                    <input
                      aria-label="Select editable tasks on this page"
                      type="checkbox"
                      checked={all}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            !all && eligible.some((r) => !!selected[r.id]);
                      }}
                      onChange={(e) => {
                        const next = { ...selected };
                        for (const row of eligible)
                          if (
                            e.target.checked &&
                            Object.keys(next).length < 100
                          )
                            next[row.id] = {
                              id: row.id,
                              expectedVersion: row.task!.version,
                            };
                          else if (!e.target.checked) delete next[row.id];
                        setSelected(next);
                      }}
                    />
                  </th>
                )}
                {visible.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    tabIndex={-1}
                    aria-sort={
                      query.sort === c
                        ? query.order === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    {tableRegistry[entity].sorts.includes(c) ? (
                      <Link
                        href={href({
                          sort: c,
                          order:
                            query.sort === c && query.order === "asc"
                              ? "desc"
                              : "asc",
                          page: 1,
                        })}
                      >
                        {labels[c]}{" "}
                        {query.sort === c
                          ? query.order === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </Link>
                    ) : (
                      labels[c]
                    )}
                  </th>
                ))}
                <th scope="col" tabIndex={-1}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} aria-rowindex={(page - 1) * 25 + i + 2}>
                  {selectable && (
                    <td tabIndex={-1}>
                      <input
                        aria-label={"Select " + String(r.values.title)}
                        type="checkbox"
                        disabled={
                          !r.canEdit ||
                          (!selected[r.id] && selectedItems.length >= 100)
                        }
                        checked={!!selected[r.id]}
                        onChange={(e) =>
                          setSelected((old) => {
                            const next = { ...old };
                            if (e.target.checked)
                              next[r.id] = {
                                id: r.id,
                                expectedVersion: r.task!.version,
                              };
                            else delete next[r.id];
                            return next;
                          })
                        }
                      />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td tabIndex={-1} key={c}>
                      <span>{r.values[c] ?? "—"}</span>
                      {r.canEdit &&
                        ((r.person &&
                          ["name", "username", "employmentType"].includes(c)) ||
                          (r.task &&
                            ["title", "priority", "dueAt"].includes(c))) && (
                          <details>
                            <summary>Edit {labels[c].toLowerCase()}</summary>
                            <InlineEditor key={r.person?.version ?? r.task?.version} row={r} field={c} />
                          </details>
                        )}
                    </td>
                  ))}
                  <td tabIndex={-1}>
                    <Link href={r.href}>Open →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p>No records match your access and filters.</p>}
        <nav className="form-actions" aria-label="Structured table pages">
          {page > 1 && (
            <Link className="button" href={href({ page: page - 1 })}>
              Previous
            </Link>
          )}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link className="button" href={href({ page: page + 1 })}>
              Next
            </Link>
          )}
        </nav>
      </section>
      {selectedItems.length > 0 && (
        <BulkTaskChanges
          key={JSON.stringify(selectedItems)}
          items={selectedItems}
          onCommitted={(count) => {
            setSelected({});
            setMessage(`Updated ${count} tasks.`);
          }}
        />
      )}
    </>
  );
}
