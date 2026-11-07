import { z } from "zod";
const date = z.iso.date();
export const policySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    localStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    localEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    graceMinutes: z.number().int().min(0).max(120),
    closingBufferMinutes: z.number().int().min(0).max(240),
  })
  .strict()
  .refine((v) => v.localEnd > v.localStart, {
    message: "Overnight and split shifts are not supported.",
    path: ["localEnd"],
  });
export const assignmentSchema = z
  .object({
    userId: z.uuid(),
    policyId: z.uuid(),
    startDate: date,
    endDate: date.optional(),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "End date must follow start date.",
  });
export const leaveSchema = z
  .object({
    startDate: date,
    endDate: date,
    type: z.enum(["PERSONAL", "SICK", "OTHER"]),
    privateNote: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.endDate >= v.startDate &&
      new Date(v.endDate).getTime() - new Date(v.startDate).getTime() <=
        366 * 86400000,
    { message: "Use an ordered range of at most one year." },
  );
export const correctionSchema = z
  .object({
    attendanceDayId: z.uuid(),
    expectedDayVersion: z.number().int().positive(),
    proposedIn: z.iso.datetime(),
    proposedOut: z.iso.datetime(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict()
  .refine((v) => v.proposedOut > v.proposedIn, {
    message: "Check-out must follow check-in.",
  });
export type Snapshot = {
  start: string;
  end: string;
  graceMinutes: number;
  closingBufferMinutes: number;
  policyId: string;
  kind: "WORKDAY" | "HOLIDAY" | "OFF_DAY";
};
export function calculate(
  snapshot: Snapshot,
  firstIn: Date | null,
  lastOut: Date | null,
  now: Date,
  corrected = false,
) {
  if (snapshot.kind !== "WORKDAY")
    return {
      status: snapshot.kind,
      grossMinutes: null,
      late: false,
      early: false,
    };
  const start = new Date(snapshot.start),
    end = new Date(snapshot.end);
  const closed =
    now.getTime() > end.getTime() + snapshot.closingBufferMinutes * 60000;
  const status = lastOut
    ? "PRESENT"
    : firstIn
      ? closed
        ? "NEEDS_REVIEW"
        : "IN_PROGRESS"
      : closed
        ? "ABSENT"
        : "NOT_DUE";
  return {
    status,
    grossMinutes:
      firstIn && lastOut
        ? Math.floor((lastOut.getTime() - firstIn.getTime()) / 60000)
        : null,
    late:
      !!firstIn &&
      firstIn.getTime() > start.getTime() + snapshot.graceMinutes * 60000,
    early: !!lastOut && lastOut < end,
    corrected,
  };
}
