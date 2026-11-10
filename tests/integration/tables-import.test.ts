import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { mutate } = await import("@/server/transaction");
const { createProject, addMember } = await import("@/modules/projects/service");
const { editProject } = await import("@/modules/projects/lifecycle");
const { assign } = await import("@/modules/tasks/service");
const { previewCsv, previewBulk, commitPreview } =
  await import("@/modules/imports/service");
const { tableData, saveView, savedView, exportTable, removeView } =
  await import("@/modules/views/service");
const { tableQuerySchema } = await import("@/modules/views/queries");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let root: Actor,
  lead: Actor,
  member: Actor,
  reviewer: Actor,
  other: Actor,
  hr: Actor;
const suffix = crypto.randomUUID().slice(0, 8);
const run = (
  actor: Actor,
  fn: Parameters<typeof mutate>[4],
  key = crypto.randomUUID(),
) => mutate(actor, "table-" + key, key, {}, fn);
beforeAll(async () => {
  const people = [];
  for (const [name, role] of [
    ["root", "SUPER_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
    ["reviewer", "TEAM_LEAD"],
    ["other", "MEMBER"],
    ["hr", "HR_ADMIN"],
  ] as const)
    people.push(
      await db.person.create({
        data: {
          username: `grid.${name}.${suffix}`,
          email: `grid.${name}.${suffix}@example.test`,
          displayName: name,
          role,
          status: "ACTIVE",
        },
      }),
    );
  [root, lead, member, reviewer, other, hr] = people;
});
afterAll(async () => {
  await db.person.updateMany({
    where: {
      id: { in: [root, lead, member, reviewer, other, hr].map((p) => p.id) },
    },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
async function fixture() {
  const project = (await run(lead, (tx) =>
    createProject(tx, lead, {
      name: "Tables " + suffix,
      description: "Synthetic",
    }),
  )) as { id: string };
  for (const p of [member, reviewer, hr])
    await run(lead, (tx) => addMember(tx, lead, project.id, p.id));
  return project;
}
const csv = (title = "CSV task") =>
  `title,assignee,reviewer\n${title},${member.username},${reviewer.username}`;
async function imported() {
  const p = await fixture();
  const preview = (await run(lead, (tx) =>
    previewCsv(tx, lead, p.id, csv()),
  )) as { id: string };
  const result = (await run(lead, (tx) =>
    commitPreview(tx, lead, preview.id, "TASK_IMPORT"),
  )) as { ids: string[] };
  return { p, id: result.ids[0] };
}
it("returns scoped filtered/sorted stable pages with counts and no member contact leakage", async () => {
  const { p, id } = await imported();
  const query = tableQuerySchema.parse({ entity: "tasks", project: p.id });
  expect((await tableData(lead, query)).rows.map((r) => r.id)).toContain(id);
  expect((await tableData(other, query)).total).toBe(0);
  expect((await tableData(member, query)).rows[0].canEdit).toBe(false);
  const people = await tableData(
    lead,
    tableQuerySchema.parse({ entity: "people", q: member.username }),
  );
  expect(people.total).toBe(1);
  expect(people.rows[0].values).not.toHaveProperty("email");
  for (let i = 0; i < 27; i++)
    await db.task.create({
      data: {
        projectId: p.id,
        description: "Synthetic",
        title: "Page " + String(i).padStart(2, "0"),
        assigneeId: member.id,
        reviewerId: reviewer.id,
      },
    });
  const q = tableQuerySchema.parse({
    entity: "tasks",
    project: p.id,
    q: "Page",
    sort: "title",
    page: 99,
  });
  const last = await tableData(lead, q);
  expect(last.total).toBe(27);
  expect(last.page).toBe(2);
  expect(last.rows).toHaveLength(2);
  expect(last.rows[0].values.title).toBe("Page 25");
  await expect(tableData(hr, query)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("keeps saved views private even from another root, validates columns and detects stale updates", async () => {
  const filters = tableQuerySchema.parse({ entity: "tasks" }),
    input = {
      entity: "tasks" as const,
      expectedVersion: 0,
      name: "Mine",
      columns: ["title", "priority"],
      filters,
    };
  const view = (await run(lead, (tx) => saveView(tx, lead, input))) as {
    id: string;
  };
  await expect(savedView(root, view.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    run(lead, (tx) => saveView(tx, lead, { ...input, columns: ["email"] })),
  ).rejects.toMatchObject({ code: "INVALID_VIEW" });
  await run(lead, (tx) =>
    saveView(
      tx,
      lead,
      { ...input, expectedVersion: 1, name: "Updated" },
      view.id,
    ),
  );
  await expect(
    run(lead, (tx) =>
      saveView(tx, lead, { ...input, expectedVersion: 1 }, view.id),
    ),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
  await run(lead, (tx) => removeView(tx, lead, view.id, 2));
  await expect(savedView(lead, view.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("previews all CSV rows, rejects unavailable/HR/self reviewers, then atomically imports and replays once", async () => {
  const p = await fixture();
  const bad = (await run(lead, (tx) =>
    previewCsv(
      tx,
      lead,
      p.id,
      csv() + `\nInvalid,${member.username},${hr.username}`,
    ),
  )) as { valid: boolean; errors: unknown[] };
  expect(bad.valid).toBe(false);
  expect(bad.errors).toHaveLength(1);
  expect(await db.task.count({ where: { projectId: p.id } })).toBe(0);
  const text =
    csv('"Quoted, title"') + `\nSecond,${member.username},${reviewer.username}`;
  const preview = (await run(lead, (tx) =>
    previewCsv(tx, lead, p.id, text),
  )) as { id: string; count: number };
  expect(preview.count).toBe(2);
  await expect(
    run(root, (tx) => commitPreview(tx, root, preview.id, "TASK_IMPORT")),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const a = await run(lead, (tx) =>
    commitPreview(tx, lead, preview.id, "TASK_IMPORT"),
  );
  const b = await run(lead, (tx) =>
    commitPreview(tx, lead, preview.id, "TASK_IMPORT"),
  );
  expect(b).toEqual(a);
  expect(await db.task.count({ where: { projectId: p.id } })).toBe(2);
  expect(
    (await db.changePreview.findUniqueOrThrow({ where: { id: preview.id } }))
      .payload,
  ).not.toHaveProperty("tasks");
});
it("rechecks membership and account status between preview and commit with no partial imports", async () => {
  const p = await fixture(),
    preview = (await run(lead, (tx) => previewCsv(tx, lead, p.id, csv()))) as {
      id: string;
    };
  await db.projectMember.delete({
    where: { projectId_userId: { projectId: p.id, userId: member.id } },
  });
  await expect(
    run(lead, (tx) => commitPreview(tx, lead, preview.id, "TASK_IMPORT")),
  ).rejects.toMatchObject({ code: "IMPORT_CONFLICT" });
  expect(await db.task.count({ where: { projectId: p.id } })).toBe(0);
  await db.changePreview.update({
    where: { id: preview.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expect(
    run(lead, (tx) => commitPreview(tx, lead, preview.id, "TASK_IMPORT")),
  ).rejects.toMatchObject({ code: "PREVIEW_EXPIRED" });
});
it("bulk commit is all-or-nothing under stale versions and checks current manager authority", async () => {
  const { p, id } = await imported();
  const second = await db.task.create({
    data: {
      projectId: p.id,
      description: "Synthetic",
      title: "Second bulk",
      assigneeId: member.id,
      reviewerId: reviewer.id,
    },
  });
  const input = {
    items: [
      { id, expectedVersion: 1 },
      { id: second.id, expectedVersion: 1 },
    ],
    updates: { priority: "HIGH" as const },
    reason: "Priority change",
  };
  const preview = (await run(lead, (tx) => previewBulk(tx, lead, input))) as {
    id: string;
  };
  await db.task.update({
    where: { id: second.id },
    data: { version: { increment: 1 } },
  });
  await expect(
    run(lead, (tx) => commitPreview(tx, lead, preview.id, "TASK_BULK")),
  ).rejects.toMatchObject({ code: "BULK_CONFLICT" });
  expect((await db.task.findUniqueOrThrow({ where: { id } })).priority).toBe(
    "NORMAL",
  );
  const input2 = {
    ...input,
    items: [
      { id, expectedVersion: 1 },
      { id: second.id, expectedVersion: 2 },
    ],
  };
  const next = (await run(lead, (tx) => previewBulk(tx, lead, input2))) as {
    id: string;
  };
  await run(root, (tx) =>
    editProject(tx, root, p.id, {
      expectedVersion: 1,
      name: "Transferred",
      description: "Synthetic",
      managerId: reviewer.id,
    }),
  );
  await expect(
    run(lead, (tx) => commitPreview(tx, lead, next.id, "TASK_BULK")),
  ).rejects.toMatchObject({ code: "BULK_CONFLICT" });
  const fresh = (await run(reviewer, (tx) =>
    previewBulk(tx, reviewer, input2),
  )) as { id: string };
  const result = (await run(reviewer, (tx) =>
    commitPreview(tx, reviewer, fresh.id, "TASK_BULK"),
  )) as { count: number };
  expect(result.count).toBe(2);
  expect((await db.task.findUniqueOrThrow({ where: { id } })).priority).toBe(
    "HIGH",
  );
});
it("exports only authorized rows/columns, neutralizes formulas and audits metadata without cell content", async () => {
  const { p, id } = await imported();
  await db.task.update({ where: { id }, data: { title: '=HYPERLINK("bad")' } });
  const query = tableQuerySchema.parse({ entity: "tasks", project: p.id });
  const text = await exportTable(member, query, ["title"]);
  expect(text).toContain("'=HYPERLINK");
  expect(await exportTable(other, query, ["title"])).toBe('"Task"');
  await expect(
    exportTable(member, tableQuerySchema.parse({ entity: "people" }), [
      "email",
    ]),
  ).rejects.toMatchObject({ code: "INVALID_COLUMNS" });
  const event = await db.audit.findFirstOrThrow({
    where: { actorId: member.id, action: "TABLE_EXPORTED" },
    orderBy: { createdAt: "desc" },
  });
  expect(JSON.stringify(event.changes)).not.toContain("HYPERLINK");
});
it("denies assigning focused HR users even when they are project members", async () => {
  const p = await fixture();
  await expect(
    run(lead, (tx) =>
      assign(tx, lead, {
        projectId: p.id,
        description: "Synthetic",
        title: "Denied",
        assigneeId: hr.id,
        reviewerId: reviewer.id,
        priority: "NORMAL",
      }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_MEMBER" });
});
it("paginates private notification filters and metadata-only Root audit records", async () => {
  const { activityList, activityQuery } =
    await import("@/modules/activity/service");
  await db.notification.createMany({
    data: Array.from({ length: 28 }, (_, n) => ({
      recipientId: member.id,
      eventKey: "table-notify-" + suffix + "-" + n,
      title: "Notice " + suffix,
      target: "/notifications",
      ...(n === 0 ? { readAt: new Date() } : {}),
    })),
  });
  const query = activityQuery.parse({ q: suffix, status: "unread", page: 999 });
  const data = await activityList(member, "notifications", query);
  expect(data.total).toBe(27);
  expect(data.page).toBe(2);
  expect(data.items).toHaveLength(2);
  expect((await activityList(other, "notifications", query)).total).toBe(0);
  await expect(
    activityList(member, "audit", activityQuery.parse({})),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const audit = await activityList(
    root,
    "audit",
    activityQuery.parse({ action: "TASK_IMPORT_COMMITTED" }),
  );
  expect(audit.total).toBeGreaterThan(0);
  expect(audit.items[0]).not.toHaveProperty("changes");
});
it("refuses replaying a receipt created under a previous role", async () => {
  const key = crypto.randomUUID();
  await run(lead, async () => ({ count: 10 }), key);
  await db.person.update({ where: { id: lead.id }, data: { role: "MEMBER" } });
  try {
    await expect(
      run({ ...lead, role: "MEMBER" }, async () => ({ count: 0 }), key),
    ).rejects.toMatchObject({ code: "PERMISSIONS_CHANGED" });
  } finally {
    await db.person.update({
      where: { id: lead.id },
      data: { role: "TEAM_LEAD" },
    });
  }
});
it("keeps correction detail private and requires a reason for independent rejection", async () => {
  const { attendanceDetail } = await import("@/modules/attendance/detail");
  const { decideCorrection } = await import("@/modules/attendance/service");
  const day = await db.attendanceDay.create({
    data: {
      userId: member.id,
      workDate: new Date("2026-02-04"),
      snapshot: { start: "2026-02-04T04:00:00Z", end: "2026-02-04T12:00:00Z" },
      status: "NEEDS_REVIEW",
    },
  });
  const correction = await db.attendanceCorrection.create({
    data: {
      dayId: day.id,
      requestedBy: member.id,
      expectedDayVersion: 1,
      proposedIn: new Date("2026-02-04T04:00:00Z"),
      proposedOut: new Date("2026-02-04T12:00:00Z"),
      reason: "Private correction note",
    },
  });
  await expect(attendanceDetail(other, day.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect((await attendanceDetail(hr, day.id)).corrections).toHaveLength(0);
  await expect(
    run(root, (tx) =>
      decideCorrection(tx, root, correction.id, {
        expectedVersion: 1,
        action: "reject",
      }),
    ),
  ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  await run(root, (tx) =>
    decideCorrection(tx, root, correction.id, {
      expectedVersion: 1,
      action: "reject",
      reason: "No supporting record",
    }),
  );
  expect(
    (await attendanceDetail(member, day.id)).corrections[0].decisionReason,
  ).toBe("No supporting record");
  expect(
    (await db.attendanceDay.findUniqueOrThrow({ where: { id: day.id } }))
      .firstIn,
  ).toBeNull();
});
