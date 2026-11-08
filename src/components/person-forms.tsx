"use client";
import { useId } from "react";
import { MutationForm } from "./mutation-form";
import { roles } from "@/modules/people/schemas";
type Person = {
  id: string;
  displayName: string;
  username: string;
  employmentType: string;
  role: string;
  status: string;
  version: number;
  canReactivate: boolean;
};
export function ProfileForm({ person }: { person: Person }) {
  const key = useId();
  return (
    <MutationForm
      endpoint={`/api/v1/users/${person.id}`}
      method="PATCH"
      label="Save profile"
      successMessage="Profile updated."
      transform={(form) => ({
        displayName: form.get("displayName"),
        username: form.get("username"),
        employmentType: form.get("employmentType"),
        expectedVersion: person.version,
      })}
    >
      <label htmlFor={key + "name"}>Display name</label>
      <input
        id={key + "name"}
        name="displayName"
        required
        maxLength={120}
        defaultValue={person.displayName}
      />
      <label htmlFor={key + "username"}>Username</label>
      <input
        id={key + "username"}
        name="username"
        required
        pattern="[a-z0-9._\-]{3,30}"
        defaultValue={person.username}
      />
      <p className="note">
        Use 3–30 lowercase letters, numbers, dots, underscores or hyphens for a
        username.
      </p>
      <label htmlFor={key + "employment"}>Employment type</label>
      <select
        id={key + "employment"}
        name="employmentType"
        defaultValue={person.employmentType}
      >
        <option value="EMPLOYEE">Employee</option>
        <option value="INTERN">Intern</option>
      </select>
      <p className="note">
        People sign in with their email address. Changing a username does not
        change their login email.
      </p>
    </MutationForm>
  );
}
export function RoleForm({ person }: { person: Person }) {
  const key = useId();
  return (
    <MutationForm
      endpoint={`/api/v1/users/${person.id}/role`}
      label="Save role"
      successMessage="Role updated. New permissions apply to subsequent requests."
      transform={(form) => ({
        role: form.get("role"),
        reason: form.get("reason"),
        expectedVersion: person.version,
      })}
    >
      <label htmlFor={key + "role"}>Account role</label>
      <select id={key + "role"} name="role" defaultValue={person.role}>
        {roles.map((role) => (
          <option key={role} value={role}>
            {role.replaceAll("_", " ").toLowerCase()}
          </option>
        ))}
      </select>
      <label htmlFor={key + "reason"}>Reason for role change</label>
      <textarea
        id={key + "reason"}
        name="reason"
        required
        minLength={3}
        maxLength={500}
      />
      <label className="confirmation">
        <input type="checkbox" required />I have reviewed this account’s access.
      </label>
    </MutationForm>
  );
}
export function AccountStatusForm({ person }: { person: Person }) {
  const key = useId(),
    reactivating = person.status === "INACTIVE";
  if (reactivating && !person.canReactivate)
    return (
      <p className="note">
        This account has no linked sign-in identity. Complete account setup
        before restoring access.
      </p>
    );
  if (!["ACTIVE", "INACTIVE"].includes(person.status))
    return (
      <p className="note">
        Manage incomplete account setup through invitations.
      </p>
    );
  return (
    <MutationForm
      endpoint={`/api/v1/users/${person.id}/${reactivating ? "reactivate" : "deactivate"}`}
      label={reactivating ? "Reactivate account" : "Deactivate account"}
      successMessage={
        reactivating
          ? "Account reactivated. The existing password is unchanged."
          : "Account deactivated. Their records are retained."
      }
      transform={(form) => ({
        expectedVersion: person.version,
        reason: form.get("reason"),
      })}
    >
      <p className="note">
        {reactivating
          ? "Restore workspace access for this linked account. Its existing role and password remain unchanged."
          : "Stop workspace access without deleting this person’s work, attendance or history. Review their open assignments before continuing."}
      </p>
      <label htmlFor={key + "reason"}>
        {reactivating ? "Reason for reactivation" : "Reason for deactivation"}
      </label>
      <textarea
        id={key + "reason"}
        name="reason"
        required
        minLength={3}
        maxLength={500}
      />
      <label className="confirmation">
        <input type="checkbox" required />
        {reactivating
          ? "I want to restore this account’s access."
          : "I want to deactivate this account."}
      </label>
    </MutationForm>
  );
}
