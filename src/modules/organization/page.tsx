import Link from "next/link";
import { organizationData } from "./service";
import type { Actor } from "@/server/context";
import { DepartmentForm, TeamForm } from "@/components/organization-forms";
export async function OrganizationPage({ actor }: { actor: Actor }) {
  const data = await organizationData(actor),
    departments = data.departments.map((d) => ({
      ...d,
      archivedAt: d.archivedAt?.toISOString() ?? null,
    }));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">COMPANY STRUCTURE</span>
          <h1>Organization</h1>
          <p className="muted">
            Departments, primary teams and current reporting relationships.
          </p>
        </div>
      </div>
      <div className="split">
        <section className="panel">
          <h2>Departments</h2>
          <details>
            <summary>Create department</summary>
            <DepartmentForm />
          </details>
          {departments.map((d) => (
            <article className="revision" key={d.id}>
              <h3>
                {d.name} {d.archivedAt && "(archived)"}
              </h3>
              <details>
                <summary>Edit department</summary>
                <DepartmentForm item={d} />
              </details>
            </article>
          ))}
        </section>
        <section className="panel">
          <h2>Teams</h2>
          <details>
            <summary>Create team</summary>
            <TeamForm departments={departments} people={data.people} />
          </details>
          {data.teams.map((t) => (
            <article className="revision" key={t.id}>
              <h3>
                {t.name} {t.archivedAt && "(archived)"}
              </h3>
              <p>
                {departments.find((d) => d.id === t.departmentId)?.name} · Lead:{" "}
                {data.people.find((p) => p.id === t.leadId)?.displayName}
              </p>
              <details>
                <summary>Edit team</summary>
                <TeamForm
                  item={{
                    ...t,
                    archivedAt: t.archivedAt?.toISOString() ?? null,
                  }}
                  departments={departments}
                  people={data.people}
                />
              </details>
            </article>
          ))}
        </section>
      </div>
      <section className="panel">
        <h2>Employee placement</h2>
        <p>
          Open an account’s employment profile to assign its department, primary
          team and manager.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Department</th>
                <th>Team</th>
                <th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => {
                const profile = data.profiles.find((x) => x.userId === p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={"/people/" + p.id + "/employment"}>
                        {p.displayName} · @{p.username}
                      </Link>
                    </td>
                    <td>
                      {departments.find((d) => d.id === profile?.departmentId)
                        ?.name ?? "—"}
                    </td>
                    <td>
                      {data.teams.find((t) => t.id === profile?.teamId)?.name ??
                        "—"}
                    </td>
                    <td>
                      {data.people.find((x) => x.id === profile?.managerId)
                        ?.displayName ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
