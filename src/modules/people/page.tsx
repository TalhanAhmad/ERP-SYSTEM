import Link from "next/link";
import type { Actor } from "@/server/context";
import { Status } from "@/components/status";
import { InvitationForm } from "@/components/work-forms";
import { InvitationsPanel } from "./invitations";
import { listPeople, peopleQuerySchema } from "./service";
import { roles } from "./schemas";
export async function AdminPeoplePage({
  actor,
  searchParams,
}: {
  actor: Actor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const parsed = peopleQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(searchParams).filter(([key]) =>
        ["q", "status", "role", "page"].includes(key),
      ),
    ),
  );
  const filters = parsed.success ? parsed.data : peopleQuerySchema.parse({});
  const data = parsed.success ? await listPeople(actor, filters) : null;
  const href = (page: number) =>
    "/people?" +
    new URLSearchParams({
      q: filters.q,
      status: filters.status,
      role: filters.role,
      page: String(page),
    }).toString();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WORKSPACE ADMINISTRATION</span>
          <h1>People</h1>
          <p className="muted">
            Find an account, update its profile and manage workspace access.
          </p>
        </div>
      </div>
      <section className="panel">
        <details>
          <summary>Invite a person</summary>
          <InvitationForm canInvitePrivileged />
        </details>
      </section>
      <section className="panel" aria-labelledby="people-heading">
        <h2 id="people-heading">Manage accounts</h2>
        <form action="/people" method="GET" className="people-filters">
          <label>
            Search people
            <input
              name="q"
              maxLength={100}
              defaultValue={filters.q}
              placeholder="Name, username or email"
            />
          </label>
          <label>
            Account status
            <select name="status" defaultValue={filters.status}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="INVITED">Invited</option>
              <option value="ALL">All statuses</option>
            </select>
          </label>
          <label>
            Filter by role
            <select name="role" defaultValue={filters.role}>
              <option value="ALL">All roles</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <button className="primary">Apply filters</button>
          <Link className="button" href="/people">
            Reset filters
          </Link>
        </form>
        {!parsed.success && (
          <p className="error" role="alert">
            The filters are invalid. Reset them and try again.
          </p>
        )}
        {data && (
          <>
            <p className="note">
              {data.total} account{data.total === 1 ? "" : "s"} · page{" "}
              {data.page} of {data.pages}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Employment</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((person) => (
                    <tr key={person.id}>
                      <td>
                        <strong>{person.displayName}</strong>
                        <div className="muted">@{person.username}</div>
                        <div>{person.email}</div>
                      </td>
                      <td>{person.role.replaceAll("_", " ").toLowerCase()}</td>
                      <td>{person.employmentType.toLowerCase()}</td>
                      <td>
                        <Status value={person.status} />
                      </td>
                      <td>
                        <Link className="button" href={`/people/${person.id}`}>
                          Manage
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && (
              <p className="empty">No accounts match these filters.</p>
            )}
            <nav className="form-actions" aria-label="People pages">
              {data.page > 1 && (
                <Link className="button" href={href(data.page - 1)}>
                  Previous page
                </Link>
              )}
              {data.page < data.pages && (
                <Link className="button" href={href(data.page + 1)}>
                  Next page
                </Link>
              )}
            </nav>
          </>
        )}
      </section>
      <InvitationsPanel actor={actor} />
    </>
  );
}
