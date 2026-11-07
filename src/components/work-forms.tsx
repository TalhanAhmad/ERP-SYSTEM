"use client";
import { MutationForm } from "./mutation-form";
export function ProjectForm() {
  return (
    <MutationForm endpoint="/api/v1/projects" label="Create project">
      <label>
        Project name
        <input name="name" required maxLength={120} />
      </label>
      <label>
        Description
        <textarea name="description" maxLength={5000} />
      </label>
    </MutationForm>
  );
}
export function InvitationForm({
  canInvitePrivileged = false,
}: {
  canInvitePrivileged?: boolean;
}) {
  return (
    <MutationForm
      endpoint="/api/v1/invitations"
      label="Queue invitation"
      successMessage="Invitation queued for email delivery."
    >
      <div className="form-grid">
        <label>
          Display name
          <input name="displayName" required maxLength={120} />
        </label>
        <label>
          Username
          <input name="username" required pattern="[a-z0-9._\-]{3,30}" />
        </label>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Role
          <select name="role">
            <option>MEMBER</option>
            {canInvitePrivileged && (
              <>
                <option>TEAM_LEAD</option>
                <option>HR_ADMIN</option>
                <option>SUPER_ADMIN</option>
              </>
            )}
          </select>
        </label>
        <label>
          Employment type
          <select name="employmentType">
            <option>EMPLOYEE</option>
            <option>INTERN</option>
          </select>
        </label>
      </div>
    </MutationForm>
  );
}
export function InvitationAction({
  id,
  version,
  action,
}: {
  id: string;
  version: number;
  action: "resend" | "revoke";
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/invitations/${id}/${action}`}
      label={action === "resend" ? "Resend invitation" : "Revoke invitation"}
      transform={() => ({ expectedVersion: version })}
      successMessage={
        action === "resend"
          ? "New invitation queued. The previous link is invalid."
          : "Invitation revoked. Its link no longer works."
      }
    />
  );
}
type Option = { id: string; displayName: string; username: string };
export function TaskForm({
  projects,
  people,
}: {
  projects: { id: string; name: string }[];
  people: Option[];
}) {
  return (
    <MutationForm
      endpoint="/api/v1/tasks"
      label="Assign task"
      transform={(f) => {
        const data = Object.fromEntries(f);
        if (!data.dueAt) delete data.dueAt;
        else data.dueAt = new Date(String(data.dueAt)).toISOString();
        return data;
      }}
    >
      <label>
        Task title
        <input name="title" required maxLength={200} />
      </label>
      <label>
        Instructions
        <textarea name="description" maxLength={5000} />
      </label>
      <div className="form-grid">
        <label>
          Project
          <select name="projectId" required>
            <option value="">Select project</option>
            {projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select name="priority">
            <option>NORMAL</option>
            <option>LOW</option>
            <option>HIGH</option>
            <option>URGENT</option>
          </select>
        </label>
        {["assigneeId", "reviewerId"].map((name) => (
          <label key={name}>
            {name === "assigneeId" ? "Assignee" : "Independent reviewer"}
            <select name={name} required>
              <option value="">Select person</option>
              {people.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.displayName} (@{p.username})
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Deadline (your local timezone)
          <input type="datetime-local" name="dueAt" />
        </label>
      </div>
      <p className="note">
        Both people must be active project members. Add membership before
        assigning work.
      </p>
    </MutationForm>
  );
}
export function MemberForm({
  projectId,
  people,
}: {
  projectId: string;
  people: Option[];
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/projects/${projectId}/members`}
      label="Add member"
    >
      <label>
        Person
        <select name="userId" required>
          <option value="">Select person</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              @{p.username} · {p.displayName}
            </option>
          ))}
        </select>
      </label>
    </MutationForm>
  );
}
export function TransitionForm({
  id,
  version,
  status,
}: {
  id: string;
  version: number;
  status: string;
}) {
  const next =
    status === "ASSIGNED"
      ? "IN_PROGRESS"
      : status === "BLOCKED"
        ? "IN_PROGRESS"
        : "BLOCKED";
  return (
    <MutationForm
      endpoint={`/api/v1/tasks/${id}/status`}
      label={
        next === "BLOCKED"
          ? "Mark blocked"
          : status === "ASSIGNED"
            ? "Start task"
            : "Resolve blocker"
      }
      transform={() => ({ expectedVersion: version, status: next })}
    />
  );
}
export function SubmissionForm({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/tasks/${id}/submissions`}
      label="Submit for review"
      transform={(f) => ({
        expectedVersion: version,
        summary: f.get("summary"),
        artifactLinks: String(f.get("links"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      })}
    >
      <label>
        What did you complete?
        <textarea name="summary" required maxLength={5000} />
      </label>
      <label>
        HTTPS artifact links (one per line, up to 10)
        <textarea
          name="links"
          placeholder="https://github.com/company/project/pull/123"
        />
      </label>
    </MutationForm>
  );
}
export function ReviewForm({
  submissionId,
  version,
}: {
  submissionId: string;
  version: number;
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/submissions/${submissionId}/review`}
      label="Record review"
      transform={(f) => ({
        expectedVersion: version,
        decision: f.get("decision"),
        feedback: f.get("feedback"),
      })}
    >
      <label>
        Decision
        <select name="decision">
          <option value="APPROVE">Approve work</option>
          <option value="REQUEST_CHANGES">Request changes</option>
        </select>
      </label>
      <label>
        Feedback
        <textarea name="feedback" maxLength={2000} />
      </label>
    </MutationForm>
  );
}
export function ReadButton({ id }: { id: string }) {
  return (
    <MutationForm
      endpoint={`/api/v1/notifications/${id}/read`}
      label="Mark read"
    />
  );
}
