import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  FolderKanban,
  CheckCircle2,
  Clock3,
  ListTodo,
} from "lucide-react";
import { DayPage } from "@/modules/attendance/page";
import { context } from "@/server/context";
import { db } from "@/server/db";
import { listProjects } from "@/modules/projects/service";
import { listTasks } from "@/modules/tasks/service";
import { dashboard } from "@/modules/projects/dashboard";
import { Status } from "@/components/status";
import {
  ProjectForm,
  TaskForm,
  InvitationForm,
  MemberForm,
  ReadButton,
  InvitationAction,
} from "@/components/work-forms";
import { listInvitations } from "@/modules/identity/service";
import { emailStatus, emailTestMode } from "@/lib/email-config";
export default async function Section({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const actor = await context();
  if (
    ["attendance", "schedules", "leave", "corrections", "reports"].includes(
      section,
    )
  )
    return <DayPage section={section} />;
  const projects = await listProjects(actor);
  const tasks = await listTasks(actor);
  const manage = actor.role === "SUPER_ADMIN" || actor.role === "TEAM_LEAD";
  const managedProjects = projects.filter(
    (p) => p.managerId === actor.id || actor.role === "SUPER_ADMIN",
  );
  const people = await db.person.findMany({
    where: ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role)
      ? {}
      : {
          OR: [
            { id: actor.id },
            {
              memberships: {
                some: { projectId: { in: managedProjects.map((p) => p.id) } },
              },
            },
          ],
        },
    select: {
      id: true,
      displayName: true,
      username: true,
      status: true,
      role: true,
      employmentType: true,
    },
    orderBy: { username: "asc" },
    take: 100,
  });
  const activePeople = people.filter((p) => p.status === "ACTIVE");
  if (section === "dashboard") {
    const open = tasks.filter(
      (t) => !["APPROVED", "CANCELED"].includes(t.status),
    );
    const reviews = tasks.filter(
      (t) =>
        t.status === "IN_REVIEW" &&
        (t.reviewerId === actor.id || actor.role === "SUPER_ADMIN"),
    );
    const counts = await dashboard(actor);
    const stats = [
      [
        "Active projects",
        counts.projects,
        FolderKanban,
        "Projects you can access",
      ],
      [
        "Open assignments",
        counts.openTasks,
        ListTodo,
        "Across your project memberships",
      ],
      [
        "Awaiting review",
        counts.awaitingReview,
        Clock3,
        "Ready for your feedback",
      ],
      [
        "Approved work",
        counts.approved,
        CheckCircle2,
        "Independently reviewed tasks",
      ],
    ] as const;
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">YOUR WORKDAY, AT A GLANCE</span>
            <h1>Workspace overview</h1>
            <p className="muted">A little focus for the day ahead.</p>
          </div>
          <Link className="button" href="/projects">
            View projects <ArrowUpRight size={14} />
          </Link>
        </div>
        <section className="hero">
          <div>
            <span className="eyebrow">LET’S MAKE PROGRESS</span>
            <h2>Hello, {actor.displayName.split(" ")[0]}.</h2>
            <p>
              Keep your next step in sight. Pick up an assignment, share your
              progress, or give a teammate the feedback they need.
            </p>
            <Link className="button primary" href="/tasks">
              Go to my work →
            </Link>
          </div>
          <div className="hero-symbol" aria-hidden="true">
            ✳
          </div>
        </section>
        <div className="stats">
          {stats.map(([label, count, Icon, note]) => (
            <section className="stat" key={label}>
              <div className="stat-top">
                {label}
                <Icon size={17} />
              </div>
              <div className="stat-number">{count}</div>
              <small>{note}</small>
            </section>
          ))}
        </div>
        <div className="split">
          <section className="panel">
            <div className="panel-heading">
              <h2>Work in motion</h2>
              <Link className="muted" href="/tasks">
                View all →
              </Link>
            </div>
            <TaskTable tasks={open.slice(0, 6)} />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Your next steps</h2>
              <span className="badge">
                {actor.role.replaceAll("_", " ").toLowerCase()}
              </span>
            </div>
            <ul className="checks">
              <li>
                <span className="dot" />
                <span>
                  <strong>{reviews.length} pending reviews</strong>
                  <br />
                  <span className="muted">
                    Independent feedback moves work forward.
                  </span>
                </span>
              </li>
              <li>
                <span className="dot" />
                <span>
                  <strong>
                    {open.filter((t) => t.assigneeId === actor.id).length}{" "}
                    personal assignments
                  </strong>
                  <br />
                  <span className="muted">
                    Open a task to start work or submit a revision.
                  </span>
                </span>
              </li>
              <li>
                <span className="dot" />
                <span>
                  <strong>One shared source of truth</strong>
                  <br />
                  <span className="muted">
                    Every number reflects records visible to your account.
                  </span>
                </span>
              </li>
            </ul>
            <p className="note">
              This is an initial work-management release. Attendance, leave and
              reports are available in the workspace. Remaining release
              requirements are tracked in the delivery report.
            </p>
          </section>
        </div>
      </>
    );
  }
  if (section === "projects")
    return (
      <>
        <Heading
          title="Projects"
          subtitle="Bring the right people together around meaningful work."
        />
        {manage && (
          <section className="panel">
            <details>
              <summary>Create a project</summary>
              <ProjectForm />
            </details>
          </section>
        )}
        {projects.length === 0 ? (
          <Empty text="Create your first project to start assigning work." />
        ) : (
          projects.map((p) => (
            <section className="panel" key={p.id}>
              <div className="panel-heading">
                <h2>{p.name}</h2>
                <Status value={p.archivedAt ? "ARCHIVED" : "ACTIVE"} />
              </div>
              <p className="muted">
                {p.description || "No description provided."}
              </p>
              <p className="note">
                {p._count.members} members · {p._count.tasks} tasks
              </p>
              {(actor.role === "SUPER_ADMIN" || p.managerId === actor.id) && (
                <details>
                  <summary>Add a project member</summary>
                  <MemberForm projectId={p.id} people={activePeople} />
                </details>
              )}
            </section>
          ))
        )}
      </>
    );
  if (section === "tasks" || section === "my-work")
    return (
      <>
        <Heading
          title="My work"
          subtitle="Assignments, submissions, and the feedback that moves them forward."
        />
        {manage && (
          <section className="panel">
            <details>
              <summary>Assign a task</summary>
              <TaskForm projects={managedProjects} people={activePeople} />
            </details>
          </section>
        )}
        <section className="panel">
          <TaskTable tasks={tasks} />
        </section>
      </>
    );
  if (section === "people") {
    const canInvite = ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role);
    const invitations = canInvite ? await listInvitations(actor) : [];
    return (
      <>
        <Heading
          title="People"
          subtitle="The people in your workspace, within your current access."
        />
        {canInvite && (
          <section className="panel">
            <details>
              <summary>Invite a person</summary>
              <InvitationForm
                canInvitePrivileged={actor.role === "SUPER_ADMIN"}
              />
            </details>
          </section>
        )}
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Employment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.displayName}</strong>
                      <div className="muted">@{p.username}</div>
                    </td>
                    <td>{p.role.replaceAll("_", " ").toLowerCase()}</td>
                    <td>{p.employmentType.toLowerCase()}</td>
                    <td>
                      <Status value={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {canInvite && (
          <section className="panel" aria-labelledby="invitations-heading">
            <h2 id="invitations-heading">Invitations</h2>
            {emailStatus() !== "READY" && (
              <p className="error" role="status">
                Email delivery is not configured. Invitations will remain queued
                until an email service is connected.
              </p>
            )}
            {emailTestMode() && (
              <p className="note" role="status">
                Email is in personal demo mode and can only reach the configured
                test inbox. Invitations to other people need a verified sending
                domain.
              </p>
            )}
            <p className="note">
              Sending or resending attempts email delivery when the service is
              configured. Resending replaces the previous link. Revoking
              prevents account creation. An email already being sent may still
              arrive, but its canceled link will not work.
            </p>
            {invitations.length === 0 ? (
              <Empty text="No invitations yet." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Email</th>
                      <th>Expires (Karachi)</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.displayName}</strong>
                          <div>{item.email}</div>
                          <div className="muted">@{item.username}</div>
                        </td>
                        <td>{item.role.replaceAll("_", " ").toLowerCase()}</td>
                        <td>
                          <Status value={item.status} />
                          {item.processing && (
                            <p className="note">Account creation in progress</p>
                          )}
                        </td>
                        <td>
                          {
                            {
                              QUEUED: "Queued",
                              SMTP_ACCEPTED: "Accepted by email server",
                              CANCELED: "Canceled",
                              RETRYING: "Retrying",
                              FAILED: "Failed",
                            }[item.delivery]
                          }
                        </td>
                        <td>
                          {new Intl.DateTimeFormat("en-GB", {
                            timeZone: "Asia/Karachi",
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(item.expiresAt)}
                        </td>
                        <td>
                          {!["ACCEPTED", "REVOKED"].includes(item.status) && (
                            <div className="stack">
                              {!item.processing && (
                                <InvitationAction
                                  id={item.id}
                                  version={item.version}
                                  action="resend"
                                />
                              )}
                              <InvitationAction
                                id={item.id}
                                version={item.version}
                                action="revoke"
                              />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </>
    );
  }
  if (section === "notifications") {
    const items = await db.notification.findMany({
      where: { recipientId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return (
      <>
        <Heading
          title="Notifications"
          subtitle="Updates from the work you’re part of."
        />
        <section className="panel">
          {items.length === 0 ? (
            <Empty text="You’re all caught up. New assignments and review updates will appear here." />
          ) : (
            items.map((item) => (
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
            ))
          )}
        </section>
      </>
    );
  }
  if (section === "audit" && actor.role === "SUPER_ADMIN") {
    const records = await db.audit.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return (
      <>
        <Heading
          title="Audit log"
          subtitle="A record of successful workspace changes."
        />
        <section className="panel">
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
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.action.replaceAll("_", " ").toLowerCase()}</td>
                    <td>{r.entityId}</td>
                    <td>{r.createdAt.toISOString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }
  notFound();
}
function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">ENCOVA WORKSPACE</span>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <strong>A clear space to begin.</strong>
      {text}
    </div>
  );
}
function TaskTable({
  tasks,
}: {
  tasks: Awaited<ReturnType<typeof listTasks>>;
}) {
  return tasks.length === 0 ? (
    <Empty text="No assignments yet. Your tasks will appear here when work is assigned." />
  ) : (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task / project</th>
            <th>Assignee</th>
            <th>Status</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td>
                <Link href={`/tasks/${t.id}`}>
                  <strong>{t.title}</strong>
                </Link>
                <div className="muted">{t.project.name}</div>
              </td>
              <td>@{t.assignee.username}</td>
              <td>
                <Status value={t.status} />
              </td>
              <td>{t.priority.toLowerCase()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
