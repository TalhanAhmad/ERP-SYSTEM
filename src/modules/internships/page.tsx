import Link from "next/link";
import type { Actor } from "@/server/context";
import {
  internshipDirectory,
  internshipOptions,
  internshipQuery,
} from "./service";
import { EnrollmentForm } from "@/components/internship-forms";
import { Status } from "@/components/status";
export async function InternshipsPage({
  actor,
  searchParams,
}: {
  actor: Actor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const parsed = internshipQuery.safeParse(
      Object.fromEntries(
        Object.entries(searchParams).filter(([k]) =>
          ["q", "status", "page"].includes(k),
        ),
      ),
    ),
    query = parsed.success ? parsed.data : internshipQuery.parse({});
  const data = await internshipDirectory(actor, query),
    options =
      actor.role === "SUPER_ADMIN" ? await internshipOptions(actor) : null;
  const href = (page: number) =>
    "/internships?" + new URLSearchParams({ ...query, page: String(page) });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LEARN THROUGH APPROVED WORK</span>
          <h1>Internships</h1>
          <p className="muted">
            Learning plans, independent mentorship and weekly feedback.
          </p>
        </div>
      </div>
      {options && (
        <section className="panel">
          <details>
            <summary>Enroll an intern</summary>
            <EnrollmentForm
              options={{
                ...options,
                departments: options.departments.map((d) => ({
                  ...d,
                  archivedAt: d.archivedAt?.toISOString() ?? null,
                })),
              }}
            />
          </details>
          <p className="note">
            Designate an account as INTERN in People and create a department in
            Organization before enrolling.
          </p>
        </section>
      )}
      <section className="panel">
        <form action="/internships" method="GET" className="people-filters">
          <label>
            Find intern or mentor
            <input name="q" maxLength={100} defaultValue={query.q} />
          </label>
          <label>
            Enrollment status
            <select name="status" defaultValue={query.status}>
              <option value="all">All enrollments</option>
              <option>ACTIVE</option>
              <option>COMPLETED</option>
              <option>CANCELED</option>
            </select>
          </label>
          <button className="primary">Apply filters</button>
          <Link className="button" href="/internships">
            Reset filters
          </Link>
        </form>
        {!parsed.success && (
          <p className="error">Choose valid enrollment filters.</p>
        )}
        <h2>{data.total} enrollments</h2>
        {data.items.map((i) => (
          <article className="revision" key={i.id}>
            <div className="panel-heading">
              <h3>
                <Link href={"/internships/" + i.id}>
                  {i.intern?.displayName} · @{i.intern?.username} →
                </Link>
              </h3>
              <Status value={i.status} />
            </div>
            <p>
              Mentor: {i.mentor?.displayName} ·{" "}
              {i.startDate.toISOString().slice(0, 10)} →{" "}
              {i.endDate.toISOString().slice(0, 10)}
            </p>
          </article>
        ))}
        {!data.items.length && (
          <p>No internships match your access and filters.</p>
        )}
        <nav className="form-actions" aria-label="Internship pages">
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
