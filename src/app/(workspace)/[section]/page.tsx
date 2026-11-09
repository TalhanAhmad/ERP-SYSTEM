import { OrganizationPage } from "@/modules/organization/page";
import { companySettings } from "@/modules/settings/service";
import { SettingsForm } from "@/components/settings-form";
import { AssignmentsPage } from "@/modules/tasks/page";
import { ProjectsPage } from "@/modules/projects/page";
import { AdminPeoplePage } from "@/modules/people/page";
import Link from "next/link";
import { HrPage } from "@/modules/hr/page";
import { hrSectionAllowed } from "@/lib/hr-access";
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
import { ReadButton } from "@/components/work-forms";
export default async function Section({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  const actor = await context();
  if (section === "organization" && actor.role === "SUPER_ADMIN")
    return <OrganizationPage actor={actor} />;
  if (section === "settings" && actor.role === "SUPER_ADMIN") {
    const item = await companySettings();
    return (
      <>
        <Heading
          title="Company settings"
          subtitle="Configure company policy and report reminders."
        />
        <section className="panel">
          <SettingsForm
            item={{
              ...item,
              workweek: item.workweek as number[],
              policyConfirmedAt: item.policyConfirmedAt?.toISOString() ?? null,
            }}
          />
        </section>
      </>
    );
  }
  if (section === "people" && actor.role === "SUPER_ADMIN")
    return <AdminPeoplePage actor={actor} searchParams={await searchParams} />;
  if (!hrSectionAllowed(actor.role, section)) notFound();
  if (
    actor.role === "HR_ADMIN" &&
    ["dashboard", "attendance"].includes(section)
  )
    return (
      <HrPage
        actor={actor}
        attendance={section === "attendance"}
        searchParams={await searchParams}
      />
    );
  if (section === "attendance" && actor.role === "SUPER_ADMIN")
    return (
      <HrPage actor={actor} attendance searchParams={await searchParams} />
    );
  if (["assignments", "tasks", "my-work"].includes(section))
    return <AssignmentsPage actor={actor} searchParams={await searchParams} />;
  if (section === "projects")
    return <ProjectsPage actor={actor} searchParams={await searchParams} />;
  if (
    ["attendance", "schedules", "leave", "corrections", "reports"].includes(
      section,
    )
  )
    return <DayPage section={section} />;
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
  const projects = await listProjects(actor);
  const tasks = await listTasks(actor);
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
  if (section === "dashboard") {
    const open = tasks.filter(
      (t) => !["APPROVED", "CANCELED"].includes(t.status),
    );
    const counts = await dashboard(actor);
    const stats = [
      [
        "Active projects",
        counts.projects,
        FolderKanban,
        "Projects you can access",
        "/projects?status=active",
      ],
      [
        "Open assignments",
        counts.openTasks,
        ListTodo,
        "Work still in progress",
        "/assignments?view=open",
      ],
      [
        "Awaiting review",
        counts.awaitingReview,
        Clock3,
        "Ready for independent feedback",
        "/assignments?view=review",
      ],
      [
        "Approved work",
        counts.approved,
        CheckCircle2,
        "Independently reviewed tasks",
        "/assignments?view=approved",
      ],
    ] as const;
    return (
      <>
        <div className="page-heading">
          <div>
            <span className="eyebrow">YOUR WORKDAY, AT A GLANCE</span>
            <h1>Workspace overview</h1>
            <p className="muted">
              Projects, assignments and team progress in one place.
            </p>
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
              {actor.role === "SUPER_ADMIN"
                ? "Assign work, review progress and view your team’s attendance."
                : "Open your assignments, share progress and review your teammates’ work."}
            </p>
            <div className="form-actions">
              <Link
                className="button primary"
                href={
                  actor.role === "SUPER_ADMIN"
                    ? "/assignments/new"
                    : "/assignments"
                }
              >
                {actor.role === "SUPER_ADMIN"
                  ? "Assign a task →"
                  : "Go to my work →"}
              </Link>
              {actor.role === "SUPER_ADMIN" && (
                <Link className="button" href="/attendance">
                  View team attendance →
                </Link>
              )}
            </div>
          </div>
          <div className="hero-symbol" aria-hidden="true">
            ✳
          </div>
        </section>
        <div className="stats">
          {stats.map(([label, count, Icon, note, href]) => (
            <Link className="stat stat-link" key={label} href={href}>
              <div className="stat-top">
                {label}
                <Icon size={17} />
              </div>
              <div className="stat-number">{count}</div>
              <small>{note}</small>
              <span className="card-action">View list →</span>
            </Link>
          ))}
        </div>
        <div className="split">
          <section className="panel">
            <div className="panel-heading">
              <h2>Work in motion</h2>
              <Link className="muted" href="/assignments?view=open">
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
                  <strong>{counts.awaitingReview} pending reviews</strong>
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
              {actor.role === "SUPER_ADMIN"
                ? "Your attendance access is view-only. HR, Team Leads and Members record their own check-in and check-out."
                : "Use Attendance to record your own check-in and check-out."}
            </p>
          </section>
        </div>
      </>
    );
  }
  if (section === "people")
    return (
      <>
        <Heading title="People" subtitle="People within your project access." />
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
      </>
    );
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
