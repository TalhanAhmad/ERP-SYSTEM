import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { context } from "@/server/context";
import { db } from "@/server/db";
import {
  organizationData,
  employeeDetail,
} from "@/modules/organization/service";
import { EmployeeForm } from "@/components/organization-forms";
export default async function Employment({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await context(),
    { id } = await params;
  if (actor.role !== "SUPER_ADMIN" || !z.uuid().safeParse(id).success)
    notFound();
  const person = await db.person.findUnique({
    where: { id },
    select: { displayName: true, username: true },
  });
  if (!person) notFound();
  const [data, p] = await Promise.all([
    organizationData(actor),
    employeeDetail(actor, id),
  ]);
  return (
    <>
      <Link href={"/people/" + id}>← Back to account</Link>
      <div className="page-heading">
        <div>
          <h1>Employment profile</h1>
          <p>
            {person.displayName} · @{person.username}
          </p>
        </div>
      </div>
      <section className="panel">
        <EmployeeForm
          userId={id}
          item={
            p
              ? {
                  ...p,
                  joiningDate:
                    p.joiningDate?.toISOString().slice(0, 10) ?? null,
                  internshipEndDate:
                    p.internshipEndDate?.toISOString().slice(0, 10) ?? null,
                }
              : null
          }
          departments={data.departments.map((d) => ({
            ...d,
            archivedAt: d.archivedAt?.toISOString() ?? null,
          }))}
          teams={data.teams.map((t) => ({
            ...t,
            archivedAt: t.archivedAt?.toISOString() ?? null,
          }))}
          people={data.people}
        />
      </section>
    </>
  );
}
