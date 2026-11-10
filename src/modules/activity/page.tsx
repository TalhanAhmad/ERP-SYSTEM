import Link from "next/link";
import type { Actor } from "@/server/context";
import { activityQuery, activityList } from "./service";
import { ReadButton } from "@/components/work-forms";
import {
  ReadAllNotifications,
  NotificationPreferences,
} from "@/components/notification-forms";
import { notificationPreference } from "@/modules/notifications/service";
export async function ActivityPage({
  actor,
  kind,
  searchParams,
}: {
  actor: Actor;
  kind: "notifications" | "audit";
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const parsed = activityQuery.safeParse(
      Object.fromEntries(
        Object.entries(searchParams).filter(([k]) =>
          ["q", "status", "action", "order", "page"].includes(k),
        ),
      ),
    ),
    query = parsed.success ? parsed.data : activityQuery.parse({}),
    data = await activityList(actor, kind, query),
    prefs =
      kind === "notifications" ? await notificationPreference(actor) : null;
  const href = (page: number) =>
    "/" + kind + "?" + new URLSearchParams({ ...query, page: String(page) });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ENCOVA WORKSPACE</span>
          <h1>{kind === "audit" ? "Audit log" : "Notifications"}</h1>
          <p className="muted">{data.total} matching records</p>
        </div>
      </div>
      <section className="panel">
        <form action={"/" + kind} method="GET" className="people-filters">
          <label>
            Search {kind}
            <input name="q" defaultValue={query.q} maxLength={100} />
          </label>
          {kind === "notifications" ? (
            <label>
              Read status
              <select name="status" defaultValue={query.status}>
                <option value="all">All</option>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
              </select>
            </label>
          ) : (
            <label>
              Exact audit action
              <input
                name="action"
                pattern="[A-Z_]*"
                maxLength={80}
                defaultValue={query.action}
              />
            </label>
          )}
          <label>
            Activity order
            <select name="order" defaultValue={query.order}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
          <button className="primary">Apply activity filters</button>
          <Link className="button" href={"/" + kind}>
            Reset filters
          </Link>
        </form>
        {!parsed.success && (
          <p className="error" role="alert">
            Choose valid search and activity filters.
          </p>
        )}
      </section>
      {prefs && (
        <section className="panel">
          <ReadAllNotifications />
          {actor.role !== "HR_ADMIN" && (
            <details>
              <summary>Notification preferences</summary>
              <NotificationPreferences
                version={prefs.version}
                reportReminders={prefs.reportReminders}
              />
            </details>
          )}
        </section>
      )}
      <section className="panel">
        {data.items.length === 0 ? (
          <p>No records match these filters.</p>
        ) : kind === "notifications" ? (
          data.items.map(
            (item) =>
              "title" in item && (
                <div className="notification" key={item.id}>
                  <div>
                    <Link href={item.target}>{item.title} →</Link>
                    <p className="note">
                      {item.createdAt.toISOString().slice(0, 10)} ·{" "}
                      {item.readAt ? "Read" : "Unread"}
                    </p>
                  </div>
                  {!item.readAt && <ReadButton id={item.id} />}
                </div>
              ),
          )
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Object</th>
                  <th>Timestamp (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(
                  (item) =>
                    "action" in item && (
                      <tr key={item.id}>
                        <td>
                          {item.action.replaceAll("_", " ").toLowerCase()}
                        </td>
                        <td>{item.entityId}</td>
                        <td>{item.createdAt.toISOString()}</td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
          </div>
        )}
        <nav className="form-actions" aria-label="Activity pages">
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
