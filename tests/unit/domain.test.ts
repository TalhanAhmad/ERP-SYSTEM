import { describe, it, expect } from "vitest";
import {
  assigneeTransition,
  independent,
  states,
} from "@/modules/tasks/policy";
import { createTask, submitTask, reviewTask } from "@/modules/tasks/schemas";
import { invitationSchema } from "@/modules/identity/schemas";
import { workDate, csvCell } from "@/lib/dates";
const projectId = crypto.randomUUID(),
  assigneeId = crypto.randomUUID(),
  reviewerId = crypto.randomUUID();
describe("Task state machine", () => {
  const allowed = [
    "ASSIGNED:IN_PROGRESS",
    "IN_PROGRESS:BLOCKED",
    "BLOCKED:IN_PROGRESS",
  ];
  for (const from of states)
    for (const to of states)
      it(`${from} → ${to}`, () => {
        const call = () => assigneeTransition(from, to);
        if (allowed.includes(`${from}:${to}`)) expect(call).not.toThrow();
        else expect(call).toThrow();
      });
  it("denies self-approval for any identity", () => {
    expect(() => independent(assigneeId, assigneeId)).toThrow("independent");
    expect(() => independent(reviewerId, assigneeId)).not.toThrow();
  });
});
describe("Strict schemas", () => {
  const valid = { projectId, assigneeId, reviewerId, title: "Reviewable work" };
  it("rejects extra role fields", () =>
    expect(
      createTask.safeParse({ ...valid, role: "SUPER_ADMIN" }).success,
    ).toBe(false));
  it("requires a different reviewer", () =>
    expect(
      createTask.safeParse({ ...valid, reviewerId: assigneeId }).success,
    ).toBe(false));
  it("normalizes title whitespace", () =>
    expect(createTask.parse({ ...valid, title: "  Work  " }).title).toBe(
      "Work",
    ));
  it.each(["http://example.test", "javascript:alert(1)", "file:///tmp/test"])(
    "rejects unsafe artifact %s",
    (url) =>
      expect(
        submitTask.safeParse({
          expectedVersion: 1,
          summary: "Done",
          artifactLinks: [url],
        }).success,
      ).toBe(false),
  );
  it("caps links at 10", () =>
    expect(
      submitTask.safeParse({
        expectedVersion: 1,
        summary: "Done",
        artifactLinks: Array(11).fill("https://example.test"),
      }).success,
    ).toBe(false));
  it("requires changes feedback", () =>
    expect(
      reviewTask.safeParse({
        expectedVersion: 1,
        decision: "REQUEST_CHANGES",
        feedback: " ",
      }).success,
    ).toBe(false));
  it("normalizes invitation identifiers", () =>
    expect(
      invitationSchema.parse({
        email: "Person@EXAMPLE.test",
        username: " Test.User ",
        displayName: "Test",
        role: "MEMBER",
        employmentType: "EMPLOYEE",
      }).username,
    ).toBe("test.user"));
});
describe("Karachi date boundaries", () => {
  it("keeps 18:59 UTC on the prior date", () =>
    expect(workDate(new Date("2026-11-07T18:59:59Z"))).toBe("2026-11-07"));
  it("rolls over at 19:00 UTC", () =>
    expect(workDate(new Date("2026-11-07T19:00:00Z"))).toBe("2026-11-08"));
});
describe("CSV safety", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-1+2", "@command", ' \t=HYPERLINK("evil")'])(
    "neutralizes %s",
    (value) => expect(csvCell(value).startsWith("\"'")).toBe(true),
  );
  it("escapes quotes", () => expect(csvCell('a"b')).toBe('"a""b"'));
});
