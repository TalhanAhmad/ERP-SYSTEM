import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { workDate } from "@/lib/dates";
import { Status } from "@/components/status";
import { CheckButton } from "@/components/day-forms";
export async function SelfAttendance({ actor }: { actor: Actor }) {
  if (actor.role === "SUPER_ADMIN") return null;
  const today = workDate(),
    date = new Date(today);
  const [day, assignment] = await Promise.all([
    db.attendanceDay.findUnique({
      where: { userId_workDate: { userId: actor.id, workDate: date } },
    }),
    db.scheduleAssignment.findFirst({
      where: {
        userId: actor.id,
        startDate: { lte: date },
        OR: [{ endDate: null }, { endDate: { gte: date } }],
      },
      select: { id: true },
    }),
  ]);
  return (
    <section className="panel" aria-label="My attendance today">
      <h2>My attendance today · {today}</h2>
      <p className="muted">Your own check-in/out · Asia/Karachi</p>
      {day && <Status value={day.status} />}
      {!assignment ? (
        <p className="note">
          Ask Super Admin to assign your work schedule before checking in.
        </p>
      ) : day?.status === "ON_LEAVE" ? (
        <p className="note">You are on approved leave today.</p>
      ) : (
        <div className="form-actions">
          {!day?.firstIn && <CheckButton kind="in" />}
          {day?.firstIn && !day.lastOut && <CheckButton kind="out" />}
          {day?.lastOut && (
            <span className="success">Your workday is closed.</span>
          )}
        </div>
      )}
    </section>
  );
}
