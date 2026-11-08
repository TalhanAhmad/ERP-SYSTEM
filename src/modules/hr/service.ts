import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { invariant } from "@/server/errors";
import { workDate } from "@/lib/dates";
export async function hrOverview(actor: Actor) {
  invariant(
    ["SUPER_ADMIN", "HR_ADMIN"].includes(actor.role),
    "FORBIDDEN",
    "HR access required.",
    403,
  );
  const date = workDate();
  const [people, days, pendingLeaves] = await Promise.all([
    db.person.findMany({
      where: { status: "ACTIVE" },
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
    people: rows,
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
