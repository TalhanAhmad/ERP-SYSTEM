import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { context } from "@/server/context";
import { personDetail } from "@/modules/people/service";
import { AppError } from "@/server/errors";
import { Status } from "@/components/status";
import {
  ProfileForm,
  RoleForm,
  AccountStatusForm,
} from "@/components/person-forms";
export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await context();
  if (actor.role !== "SUPER_ADMIN") notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const person = await personDetail(actor, id).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const own = person.id === actor.id;
  return (
    <>
      <Link className="back" href="/people">
        ← Back to people
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACCOUNT MANAGEMENT</span>
          <h1>{person.displayName}</h1>
          <p className="muted">
            @{person.username} ·{" "}
            {person.role.replaceAll("_", " ").toLowerCase()}
          </p>
        </div>
        <Status value={person.status} />
      </div>
      <section className="panel">
        <h2>Account summary</h2>
        <p>
          <strong>Login email:</strong> {person.email}
        </p>
        <p className="note">
          Login email is managed through identity verification and cannot be
          changed in this profile form.
        </p>
        <div className="stats">
          <div className="stat">
            <div className="stat-top">Open assignments</div>
            <div className="stat-number">{person.openAssignments}</div>
          </div>
          <div className="stat">
            <div className="stat-top">Managed projects</div>
            <div className="stat-number">{person.managedProjects}</div>
          </div>
        </div>
      </section>
      <section className="panel">
        <h2>Edit profile</h2>
        <ProfileForm key={`profile-${person.version}`} person={person} />
      </section>
      {own ? (
        <section className="panel">
          <h2>Your account is protected</h2>
          <p>
            Another Super Admin must change your role or deactivate your
            account.
          </p>
        </section>
      ) : (
        <div className="split">
          <section className="panel">
            <h2>Change role</h2>
            <RoleForm key={`role-${person.version}`} person={person} />
          </section>
          <section className="panel">
            <h2>
              {person.status === "INACTIVE"
                ? "Restore access"
                : "Deactivate account"}
            </h2>
            <AccountStatusForm
              key={`status-${person.version}`}
              person={person}
            />
          </section>
        </div>
      )}
      <section className="panel">
        <h2>Recent account changes</h2>
        {person.history.length ? (
          person.history.map((event) => (
            <div className="notification" key={event.id}>
              <div>
                <strong>
                  {event.action.replaceAll("_", " ").toLowerCase()}
                </strong>
                <p>
                  {event.actorName} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Asia/Karachi",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(event.createdAt)}
                </p>
                {event.reason && <p className="preline">{event.reason}</p>}
              </div>
            </div>
          ))
        ) : (
          <p className="empty">No account-management changes recorded yet.</p>
        )}
      </section>
    </>
  );
}
