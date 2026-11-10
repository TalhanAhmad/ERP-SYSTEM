import { it, expect } from "vitest";
import { parseCsv, csvTaskSchema } from "@/modules/imports/csv";
import { tableQuerySchema } from "@/modules/views/queries";
it("parses BOM, CRLF, quoted commas/newlines and escaped quotes without corrupting task text", () => {
  const rows = parseCsv(
    '\uFEFFtitle,assignee,reviewer,description\r\n"Work, one",alice,bobby,"Line one\n""quoted"""\r\n',
  );
  expect(rows).toEqual([
    {
      title: "Work, one",
      assignee: "alice",
      reviewer: "bobby",
      description: 'Line one\n"quoted"',
    },
  ]);
});
it.each([
  'title,assignee,reviewer\n"unclosed,alice,bobby',
  'title,assignee,reviewer\n"bad"extra,alice,bobby',
  "title,assignee,assignee\nx,alice,bobby",
  "title,assignee,reviewer\nx,alice",
  "title,assignee,reviewer,unknown\nx,alice,bobby,z",
])("rejects malformed or ambiguous CSV %s", (text) =>
  expect(() => parseCsv(text)).toThrow(),
);
it("bounds import rows and bytes before persistence", () => {
  expect(() =>
    parseCsv("title,assignee,reviewer\na,alice,bobby\nb,alice,bobby", 1),
  ).toThrow(/at most 1/);
  expect(() => parseCsv("x".repeat(2097153))).toThrow(/2 MB/);
});
it("normalizes project usernames/priority and requires independent review with explicit timezone deadlines", () => {
  expect(
    csvTaskSchema.parse({
      title: " Test ",
      assignee: "@ALICE",
      reviewer: "bobby",
      priority: "",
    }),
  ).toMatchObject({ title: "Test", assignee: "alice", priority: "NORMAL" });
  expect(
    csvTaskSchema.safeParse({
      title: "Test",
      assignee: "alice",
      reviewer: "@ALICE",
    }).success,
  ).toBe(false);
  expect(
    csvTaskSchema.safeParse({
      title: "Test",
      assignee: "alice",
      reviewer: "bobby",
      due_at: "2026-11-10T10:00:00",
    }).success,
  ).toBe(false);
  expect(
    csvTaskSchema.safeParse({
      title: "Test",
      assignee: "alice",
      reviewer: "bobby",
      due_at: "2026-11-10T10:00:00+05:00",
    }).success,
  ).toBe(true);
});
it("rejects table status/sort injection and unsupported columns", () => {
  expect(
    tableQuerySchema.safeParse({ entity: "tasks", sort: "passwordHash" })
      .success,
  ).toBe(false);
  expect(
    tableQuerySchema.safeParse({ entity: "people", status: "APPROVED" })
      .success,
  ).toBe(false);
  expect(
    tableQuerySchema.safeParse({ entity: "people", extra: "x" }).success,
  ).toBe(false);
});
