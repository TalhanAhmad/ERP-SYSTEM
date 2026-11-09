"use client";
import { useState } from "react";
import { MutationForm } from "./mutation-form";
export function ProjectEditForm({
  project,
}: {
  project: { id: string; version: number; name: string; description: string };
}) {
  return (
    <MutationForm
      endpoint={"/api/v1/projects/" + project.id}
      method="PATCH"
      label="Save project"
      transform={(f) => ({
        ...Object.fromEntries(f),
        expectedVersion: project.version,
      })}
    >
      <label>
        Project name
        <input
          name="name"
          required
          maxLength={120}
          defaultValue={project.name}
        />
      </label>
      <label>
        Project description
        <textarea
          name="description"
          maxLength={5000}
          defaultValue={project.description}
        />
      </label>
    </MutationForm>
  );
}
export function ReasonAction({
  endpoint,
  version,
  label,
  cancelOpen = false,
}: {
  endpoint: string;
  version: number;
  label: string;
  cancelOpen?: boolean;
}) {
  return (
    <MutationForm
      endpoint={endpoint}
      label={label}
      transform={(f) => ({
        expectedVersion: version,
        reason: f.get("reason"),
        ...(cancelOpen
          ? { cancelOpenTasks: f.get("cancelOpenTasks") === "on" }
          : {}),
      })}
    >
      <label>
        Reason
        <textarea name="reason" maxLength={1000} required />
      </label>
      {cancelOpen && (
        <label className="file-choice">
          <input type="checkbox" name="cancelOpenTasks" />
          Cancel all unfinished tasks as part of archiving
        </label>
      )}
      <label className="file-choice">
        <input type="checkbox" required />
        Confirm {label.toLowerCase()}
      </label>
    </MutationForm>
  );
}
export function RemoveMember({
  projectId,
  userId,
  version,
}: {
  projectId: string;
  userId: string;
  version: number;
}) {
  return (
    <MutationForm
      endpoint={`/api/v1/projects/${projectId}/members/${userId}/remove`}
      label="Remove member"
      transform={() => ({ expectedVersion: version })}
    >
      <label className="file-choice">
        <input type="checkbox" required />
        Confirm removing project access
      </label>
    </MutationForm>
  );
}
export function TaskEditForm({
  task,
}: {
  task: {
    id: string;
    version: number;
    title: string;
    description: string;
    priority: string;
    dueAt: string | null;
  };
}) {
  return (
    <MutationForm
      endpoint={"/api/v1/tasks/" + task.id}
      method="PATCH"
      label="Save task"
      transform={(f) => ({
        ...Object.fromEntries(f),
        expectedVersion: task.version,
        dueAt: f.get("dueAt")
          ? new Date(String(f.get("dueAt")) + ":00+05:00").toISOString()
          : null,
      })}
    >
      <label>
        Task title
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={task.title}
        />
      </label>
      <label>
        Instructions
        <textarea
          name="description"
          maxLength={5000}
          defaultValue={task.description}
        />
      </label>
      <label>
        Priority
        <select name="priority" defaultValue={task.priority}>
          {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Deadline (Asia/Karachi)
        <input
          type="datetime-local"
          name="dueAt"
          defaultValue={
            task.dueAt
              ? new Date(Date.parse(task.dueAt) + 5 * 3600000)
                  .toISOString()
                  .slice(0, 16)
              : ""
          }
        />
      </label>
    </MutationForm>
  );
}
export function ReassignForm({
  task,
  people,
}: {
  task: { id: string; version: number; assigneeId: string; reviewerId: string };
  people: { id: string; username: string; displayName: string }[];
}) {
  const [assignee, setAssignee] = useState(task.assigneeId);
  return (
    <MutationForm
      endpoint={`/api/v1/tasks/${task.id}/reassign`}
      label="Save assignment"
      transform={(f) => ({
        ...Object.fromEntries(f),
        expectedVersion: task.version,
      })}
    >
      <label>
        New assignee
        <select
          name="assigneeId"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} (@{p.username})
            </option>
          ))}
        </select>
      </label>
      <label>
        New reviewer
        <select
          key={assignee}
          name="reviewerId"
          required
          defaultValue={task.reviewerId === assignee ? "" : task.reviewerId}
        >
          <option value="">Select independent reviewer</option>
          {people
            .filter((p) => p.id !== assignee)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} (@{p.username})
              </option>
            ))}
        </select>
      </label>
      <label>
        Reason for reassignment
        <textarea name="reason" required maxLength={1000} />
      </label>
    </MutationForm>
  );
}
export function CommentForm({ taskId }: { taskId: string }) {
  return (
    <MutationForm
      endpoint={`/api/v1/tasks/${taskId}/comments`}
      label="Post comment"
    >
      <label>
        Comment
        <textarea name="body" required maxLength={2000} />
      </label>
    </MutationForm>
  );
}
