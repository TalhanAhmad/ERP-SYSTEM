"use client";
import { TextareaField } from "./textarea-field";
import { useState } from "react";
import { MutationForm } from "./mutation-form";
type Department = {
  id: string;
  name: string;
  version: number;
  archivedAt: string | null;
};
type Team = {
  id: string;
  name: string;
  version: number;
  departmentId: string;
  leadId: string;
  archivedAt: string | null;
};
type Person = {
  id: string;
  displayName: string;
  username: string;
  role: string;
  status: string;
};
export function DepartmentForm({ item }: { item?: Department }) {
  return (
    <MutationForm
      endpoint={item ? "/api/v1/departments/" + item.id : "/api/v1/departments"}
      resetOnSuccess={!item}
      label={item ? "Save department" : "Create department"}
      transform={(f) => ({
        expectedVersion: item?.version ?? 0,
        name: f.get("name"),
        archived: f.get("archived") === "on",
      })}
    >
      <label>
        Department name
        <input name="name" maxLength={120} required defaultValue={item?.name} />
      </label>
      {item && (
        <label className="file-choice">
          <input
            type="checkbox"
            name="archived"
            defaultChecked={!!item.archivedAt}
          />
          Archive department (move its teams and profiles first)
        </label>
      )}
    </MutationForm>
  );
}
export function TeamForm({
  item,
  departments,
  people,
}: {
  item?: Team;
  departments: Department[];
  people: Person[];
}) {
  return (
    <MutationForm
      endpoint={item ? "/api/v1/teams/" + item.id : "/api/v1/teams"}
      resetOnSuccess={!item}
      label={item ? "Save team" : "Create team"}
      transform={(f) => ({
        ...Object.fromEntries(f),
        expectedVersion: item?.version ?? 0,
        archived: f.get("archived") === "on",
      })}
    >
      <div className="form-grid">
        <label>
          Team name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={item?.name}
          />
        </label>
        <label>
          Department
          <select
            name="departmentId"
            required
            defaultValue={item?.departmentId ?? ""}
          >
            <option value="">Select department</option>
            {departments
              .filter((d) => !d.archivedAt)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Team lead
          <select name="leadId" required defaultValue={item?.leadId ?? ""}>
            <option value="">Select lead</option>
            {people
              .filter(
                (p) =>
                  p.status === "ACTIVE" &&
                  ["SUPER_ADMIN", "TEAM_LEAD"].includes(p.role),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} (@{p.username})
                </option>
              ))}
          </select>
        </label>
      </div>
      {item && (
        <label className="file-choice">
          <input
            name="archived"
            type="checkbox"
            defaultChecked={!!item.archivedAt}
          />
          Archive team (move its profiles first)
        </label>
      )}
    </MutationForm>
  );
}
export function EmployeeForm({
  userId,
  item,
  departments,
  teams,
  people,
}: {
  userId: string;
  item: {
    version: number;
    departmentId: string | null;
    teamId: string | null;
    managerId: string | null;
    joiningDate: string | null;
    internshipEndDate: string | null;
    workMode: string;
    privateContact: string | null;
  } | null;
  departments: Department[];
  teams: Team[];
  people: Person[];
}) {
  const [department, setDepartment] = useState(item?.departmentId ?? "");
  return (
    <MutationForm
      endpoint={"/api/v1/employee-profiles/" + userId}
      resetOnSuccess={false}
      label="Save employment profile"
      transform={(f) => {
        const data = Object.fromEntries(f);
        for (const key of [
          "departmentId",
          "teamId",
          "managerId",
          "joiningDate",
          "internshipEndDate",
          "privateContact",
        ])
          if (!data[key]) Reflect.set(data, key, null);
        return { ...data, expectedVersion: item?.version ?? 0 };
      }}
    >
      <div className="form-grid">
        <label>
          Department
          <select
            name="departmentId"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">No department</option>
            {departments
              .filter((d) => !d.archivedAt)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Primary team
          <select
            key={department}
            name="teamId"
            defaultValue={
              item?.departmentId === department ? (item?.teamId ?? "") : ""
            }
          >
            <option value="">No primary team</option>
            {teams
              .filter((t) => !t.archivedAt && t.departmentId === department)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Manager
          <select name="managerId" defaultValue={item?.managerId ?? ""}>
            <option value="">No manager</option>
            {people
              .filter((p) => p.id !== userId && p.status === "ACTIVE")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName} (@{p.username})
                </option>
              ))}
          </select>
        </label>
        <label>
          Joining date
          <input
            type="date"
            name="joiningDate"
            defaultValue={item?.joiningDate ?? ""}
          />
        </label>
        <label>
          Internship end date
          <input
            type="date"
            name="internshipEndDate"
            defaultValue={item?.internshipEndDate ?? ""}
          />
        </label>
        <label>
          Work mode
          <select name="workMode" defaultValue={item?.workMode ?? "OFFICE"}>
            <option>OFFICE</option>
            <option>REMOTE</option>
            <option>HYBRID</option>
          </select>
        </label>
      </div>
      <TextareaField
        label="Private contact (optional)"
        name="privateContact"
        maxLength={500}
        defaultValue={item?.privateContact ?? ""}
      />
      <p className="note">
        Private contact is restricted to this person and Super Admin; it is
        omitted from the organization directory and audit text.
      </p>
    </MutationForm>
  );
}
