import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { attendanceQuerySchema } from "@/modules/attendance/queries";
import type { z } from "zod";
export async function hrOverview(
  actor: Actor,
  query: z.infer<typeof attendanceQuerySchema> = attendanceQuerySchema.parse(
    {},
  ),
) {
  invariant(
    ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role),
    "FORBIDDEN",
    "HR access required.",
    403,
  );
  const date = query.date;
  const [people, days, pendingLeaves] = await Promise.all([
    db.person.findMany({
      where: { status: "ACTIVE", role: { not: "SUPER_ADMIN" } },
      select: { id: true, displayName: true, username: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    }),
    db.attendanceDay.findMany({
      where: { workDate: new Date(date) },
      select: {
        userId: true,
        firstIn: true,
        lastOut: true,
        status: true,
        late: true,
        early: true,
        corrected: true,
      },
    }),
    db.leaveRequest.count({
      where: { status: "PENDING", userId: { not: actor.id } },
    }),
  ]);
  const byPerson = new Map(days.map((d) => [d.userId, d]));
  const rows = people.map((person) => {
    const day = byPerson.get(person.id);
    return {
      ...person,
      firstIn: day?.firstIn ?? null,
      lastOut: day?.lastOut ?? null,
      status:
        day?.status === "ON_LEAVE"
          ? "On leave"
          : day?.lastOut
            ? "Checked out"
            : day?.firstIn
              ? "Checked in"
              : "Not checked in",
      late: day?.late ?? false,
      early: day?.early ?? false,
    };
  });
  return {
    date,
    people: rows.filter(
      (person) =>
        (!query.q ||
          `${person.displayName} ${person.username}`
            .toLowerCase()
            .includes(query.q.toLowerCase())) &&
        (query.status === "all" ||
          person.status.toLowerCase().replaceAll(" ", "-") === query.status),
    ),
    filters: query,
    pendingLeaves,
    counts: {
      people: rows.length,
      checkedIn: rows.filter((p) => p.status === "Checked in").length,
      checkedOut: rows.filter((p) => p.status === "Checked out").length,
      notCheckedIn: rows.filter((p) => p.status === "Not checked in").length,
      onLeave: rows.filter((p) => p.status === "On leave").length,
    },
  };
}
