"use client";
import { TextareaField } from "./textarea-field";
import { useState } from "react";
import { MutationForm } from "./mutation-form";
export function ProjectForm() {
  return (
    <MutationForm endpoint="/api/v1/projects" label="Create project">
      <label>
        Project name
        <input name="name" required maxLength={120} />
      </label>
      <TextareaField label="Description" name="description" maxLength={5000} />
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
      label="Send invitation"
      successMessage="Invitation saved. Check its email status below."
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
}: {
  projects: { id: string; name: string; people: Option[] }[];
}) {
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const people = projects.find((p) => p.id === projectId)?.people ?? [];
  return (
    <MutationForm
      endpoint="/api/v1/tasks"
      label="Assign task"
      redirectTo="/assignments?view=open"
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
      <TextareaField label="Instructions" name="description" maxLength={5000} />
      <div className="form-grid">
        <label>
          Project
          <select
            name="projectId"
            required
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setAssigneeId("");
            }}
          >
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
        <label>
          Assignee
          <select
            name="assigneeId"
            key={projectId}
            required
            disabled={!projectId}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Select person</option>
            {people.map((p) => (
              <option value={p.id} key={p.id}>
                {p.displayName} (@{p.username})
              </option>
            ))}
          </select>
        </label>
        <label>
          Independent reviewer
          <select
            name="reviewerId"
            key={projectId + assigneeId}
            required
            disabled={!assigneeId}
            defaultValue=""
          >
            <option value="">Select person</option>
            {people
              .filter((p) => p.id !== assigneeId)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.displayName} (@{p.username})
                </option>
              ))}
          </select>
        </label>
        <label>
          Deadline (your local timezone)
          <input type="datetime-local" name="dueAt" />
        </label>
      </div>
      <p className="note">
        Choose a project first. Assignees and independent reviewers are active
        members of that project. Add people from Projects if someone is missing.
      </p>
      {projectId && people.length < 2 && (
        <p className="error">
          This project needs at least two active members before you can assign
          work.
        </p>
      )}
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
  attachments = [],
}: {
  id: string;
  version: number;
  attachments?: { id: string; fileName: string; byteSize: number }[];
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/tasks/${id}/submissions`}
      label="Submit for review"
      transform={(f) => ({
        expectedVersion: version,
        summary: f.get("summary"),
        attachmentIds: f.getAll("attachmentIds"),
        artifactLinks: String(f.get("links"))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      })}
    >
      <TextareaField
        label="What did you complete?"
        name="summary"
        required
        maxLength={5000}
      />
      <TextareaField
        label="HTTPS artifact links (one per line, up to 10)"
        name="links"
        placeholder="https://github.com/company/project/pull/123"
      />
      {attachments.length > 0 && (
        <fieldset>
          <legend>Files to include in this revision</legend>
          {attachments.map((file) => (
            <label className="file-choice" key={file.id}>
              <input type="checkbox" name="attachmentIds" value={file.id} />
              <span>
                {file.fileName} · {Math.ceil(file.byteSize / 1024)} KB
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </MutationForm>
  );
}
export function ReviewForm({
  submissionId,
  version,
  override = false,
}: {
  submissionId: string;
  version: number;
  override?: boolean;
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/submissions/${submissionId}/review`}
      label="Record review"
      transform={(f) => ({
        expectedVersion: version,
        decision: f.get("decision"),
        feedback: f.get("feedback"),
        ...(override ? { overrideReason: f.get("overrideReason") } : {}),
      })}
    >
      {override && (
        <TextareaField
          label="Super Admin reviewer override reason"
          name="overrideReason"
          required
          maxLength={1000}
        />
      )}
      <label>
        Decision
        <select name="decision">
          <option value="APPROVE">Approve work</option>
          <option value="REQUEST_CHANGES">Request changes</option>
        </select>
      </label>
      <TextareaField label="Feedback" name="feedback" maxLength={2000} />
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
