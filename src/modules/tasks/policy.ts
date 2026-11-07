import { invariant } from "@/server/errors";
export const states = [
  "ASSIGNED",
  "IN_PROGRESS",
  "BLOCKED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "CANCELED",
] as const;
export type TaskState = (typeof states)[number];
export function assigneeTransition(from: TaskState, to: TaskState) {
  const allowed: Partial<Record<TaskState, TaskState[]>> = {
    ASSIGNED: ["IN_PROGRESS"],
    IN_PROGRESS: ["BLOCKED"],
    BLOCKED: ["IN_PROGRESS"],
  };
  invariant(
    allowed[from]?.includes(to),
    "INVALID_TRANSITION",
    `Cannot move from ${from} to ${to}.`,
    409,
  );
}
export function independent(actorId: string, ownerId: string) {
  invariant(
    actorId !== ownerId,
    "SELF_APPROVAL",
    "An independent reviewer is required.",
    403,
  );
}
