import "dotenv/config";
import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { mutate } = await import("@/server/transaction");
const {
  saveAnnouncement,
  deleteAnnouncement,
  activeAnnouncement,
  announcementSchema,
} = await import("@/modules/announcements/service");
const { hrOverview } = await import("@/modules/hr/service");
const { betterAuth } = await import("better-auth");
const { prismaAdapter } = await import("better-auth/adapters/prisma");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let root: Actor, root2: Actor, hr: Actor, member: Actor;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  const auth = betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  const suffix = crypto.randomUUID().slice(0, 8);
  for (const [label, role] of [
    ["root", "SUPER_ADMIN"],
    ["root2", "SUPER_ADMIN"],
    ["hr", "HR_ADMIN"],
    ["member", "MEMBER"],
  ] as const) {
    const email = `ann.${label}.${suffix}@example.test`;
    const signed = await auth.api.signUpEmail({
      body: { email, name: label, password: "Synthetic-announcement-9#" },
      asResponse: true,
    });
    const user = await db.user.update({
      where: { email },
      data: { emailVerified: true },
    });
    const person = await db.person.create({
      data: {
        email,
        username: `ann.${label}.${suffix}`,
        displayName: `Announcement ${label}`,
        role,
        status: "ACTIVE",
        authUserId: user.id,
      },
    });
    cookies[role + (label === "root2" ? "2" : "")] = signed.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    if (label === "root") root = person;
    else if (label === "root2") root2 = person;
    else if (label === "hr") hr = person;
    else member = person;
  }
});
beforeEach(async () => {
  await db.announcement.deleteMany();
});
afterAll(async () => {
  await db.announcement.deleteMany();
  await db.person.updateMany({
    where: { id: { in: [root.id, root2.id, hr.id, member.id] } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
const message = {
  title: "Company update",
  body: "One message visible to everyone.",
};
const save = (
  actor: Actor,
  input: Parameters<typeof saveAnnouncement>[2] = message,
  key = crypto.randomUUID(),
) =>
  mutate(actor, "announcements", key, input, (tx) =>
    saveAnnouncement(tx, actor, input),
  ) as Promise<{ id: string; version: number; expiresAt: string }>;
const remove = (actor: Actor, id: string, version: number) =>
  mutate(
    actor,
    "announcements/delete",
    crypto.randomUUID(),
    { id, version },
    (tx) =>
      deleteAnnouncement(tx, actor, {
        expectedId: id,
        expectedVersion: version,
      }),
  );
it("publishes one announcement for exactly 24 hours and keeps message text out of mutation/audit snapshots", async () => {
  const start = Date.now();
  const item = await save(root);
  const active = await activeAnnouncement();
  expect(active?.title).toBe(message.title);
  expect(Date.parse(item.expiresAt) - start).toBeGreaterThanOrEqual(86400000);
  expect(Date.parse(item.expiresAt) - Date.now()).toBeLessThanOrEqual(86400000);
  const log = await db.audit.findFirstOrThrow({
    where: { entityId: item.id, action: "ANNOUNCEMENT_PUBLISHED" },
  });
  expect(JSON.stringify(log.changes)).not.toContain(message.body);
  expect(JSON.stringify(item)).not.toContain(message.body);
});
it("rejects non-admin publishing, updates and deletion", async () => {
  const item = await save(root);
  for (const actor of [hr, member]) {
    await expect(save(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      save(actor, { ...message, expectedId: item.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(remove(actor, item.id, 1)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  }
});
it("serializes concurrent administrators so only one new announcement is published", async () => {
  const results = await Promise.allSettled([save(root), save(root2)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.announcement.count()).toBe(1);
});
it("resets the expiry on edit, rejects stale versions and preserves idempotent edits", async () => {
  const item = await save(root);
  await db.announcement.update({
    where: { id: item.id },
    data: {
      publishedAt: new Date(Date.now() - 12 * 3600000),
      expiresAt: new Date(Date.now() + 12 * 3600000),
    },
  });
  const input = {
      ...message,
      body: "Updated company message",
      expectedId: item.id,
      expectedVersion: 1,
    },
    key = crypto.randomUUID();
  const updated = await save(root, input, key);
  expect(updated.version).toBe(2);
  expect(Date.parse(updated.expiresAt) - Date.now()).toBeGreaterThan(86390000);
  expect(await save(root, input, key)).toEqual(updated);
  await expect(save(root, input)).rejects.toMatchObject({
    code: "STALE_VERSION",
  });
  expect((await activeAnnouncement())?.body).toBe(input.body);
});
it("does not delete a replacement announcement using an old record or version", async () => {
  const old = await save(root);
  await remove(root, old.id, 1);
  const item = await save(root);
  await expect(remove(root, old.id, 1)).rejects.toMatchObject({
    code: "ANNOUNCEMENT_CHANGED",
  });
  await expect(remove(root, item.id, 2)).rejects.toMatchObject({
    code: "STALE_VERSION",
  });
  expect((await activeAnnouncement())?.id).toBe(item.id);
});
it("expires and physically clears the message on the first read after expiry", async () => {
  const item = await save(root);
  await db.announcement.update({
    where: { id: item.id },
    data: {
      publishedAt: new Date(Date.now() - 25 * 3600000),
      expiresAt: new Date(Date.now() - 3600000),
    },
  });
  expect(await activeAnnouncement()).toBeNull();
  expect(await db.announcement.count()).toBe(0);
  await expect(
    save(root, { ...message, expectedId: item.id, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "ANNOUNCEMENT_CHANGED" });
  expect((await save(root)).id).not.toBe(item.id);
});
it("rejects externally supplied expiry/audience and mismatched optimistic-edit identifiers", () => {
  expect(
    announcementSchema.safeParse({
      ...message,
      expiresAt: "2099-01-01",
      role: "MEMBER",
    }).success,
  ).toBe(false);
  expect(
    announcementSchema.safeParse({
      ...message,
      expectedId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
  expect(announcementSchema.safeParse({ ...message, body: " " }).success).toBe(
    false,
  );
});
it("lists active people by name with not-checked-in status and excludes inactive people", async () => {
  const data = await hrOverview(hr);
  expect(data.people.find((p) => p.id === member.id)).toMatchObject({
    displayName: member.displayName,
    status: "Not checked in",
    firstIn: null,
    lastOut: null,
  });
  await db.person.update({
    where: { id: member.id },
    data: { status: "INACTIVE" },
  });
  expect((await hrOverview(hr)).people.some((p) => p.id === member.id)).toBe(
    false,
  );
  await db.person.update({
    where: { id: member.id },
    data: { status: "ACTIVE" },
  });
  await expect(hrOverview(member)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("enforces HTTP role, Origin, idempotency and uniform authenticated announcement visibility", async () => {
  const { GET, POST } = await import("@/app/api/v1/[...path]/route");
  const origin = process.env.APP_URL ?? process.env.BETTER_AUTH_URL!;
  const get = (path: string, role?: string) =>
    GET(
      new Request(`${origin}/api/v1/${path}`, {
        headers: role ? { cookie: cookies[role] } : {},
      }),
      { params: Promise.resolve({ path: path.split("/") }) },
    );
  const post = (role: string, path: string, data: unknown, extra = {}) =>
    POST(
      new Request(`${origin}/api/v1/${path}`, {
        method: "POST",
        headers: {
          cookie: cookies[role],
          Origin: new URL(origin).origin,
          "Content-Type": "application/json",
          "X-Encova-CSRF": "1",
          "Idempotency-Key": crypto.randomUUID(),
          ...extra,
        },
        body: JSON.stringify(data),
      }),
      { params: Promise.resolve({ path: path.split("/") }) },
    );
  expect((await get("announcements")).status).toBe(401);
  expect(
    (
      await post("SUPER_ADMIN", "announcements", message, {
        Origin: "https://foreign.example.test",
      })
    ).status,
  ).toBe(403);
  expect((await post("HR_ADMIN", "announcements", message)).status).toBe(403);
  expect((await post("MEMBER", "announcements", message)).status).toBe(403);
  const response = await post("SUPER_ADMIN", "announcements", message);
  expect(response.status).toBe(200);
  const json = await response.json();
  const all = [];
  for (const role of ["SUPER_ADMIN", "HR_ADMIN", "MEMBER"]) {
    const r = await get("announcements", role);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    all.push(await r.json());
  }
  expect(all[0]).toEqual(all[1]);
  expect(all[1]).toEqual(all[2]);
  for (const path of [
    "projects",
    "tasks",
    "users",
    "invitations",
    "schedules",
    "corrections",
    "reports",
    "audit",
    "operations",
  ])
    expect((await get(path, "HR_ADMIN")).status).toBe(403);
  expect((await get("hr/overview", "HR_ADMIN")).status).toBe(200);
  expect((await get("hr/overview", "MEMBER")).status).toBe(403);
  expect((await get("notifications", "HR_ADMIN")).status).toBe(200);
  expect(
    (
      await post("HR_ADMIN", "leave", {
        startDate: "2099-01-01",
        endDate: "2099-01-01",
        type: "PERSONAL",
      })
    ).status,
  ).toBe(403);
  const deletion = await post("SUPER_ADMIN", "announcements/delete", {
    expectedId: json.data.id,
    expectedVersion: 1,
  });
  expect(deletion.status).toBe(200);
  expect((await (await get("announcements", "MEMBER")).json()).data).toBeNull();
});
