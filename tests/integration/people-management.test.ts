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
const {
  editProfile,
  personDetail,
  listPeople,
  peopleQuerySchema,
  profileSchema,
  changeRole,
  deactivate,
  reactivate,
} = await import("@/modules/people/service");
const { createProject, addMember } = await import("@/modules/projects/service");
const { assign } = await import("@/modules/tasks/service");
const { betterAuth } = await import("better-auth");
const { prismaAdapter } = await import("better-auth/adapters/prisma");
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let root: Actor, other: Actor, hr: Actor, member: Actor;
const cookie = new Map<string, string>(),
  ids: string[] = [];
async function person(
  label: string,
  role: Actor["role"] = "MEMBER",
  linked = true,
) {
  const suffix = crypto.randomUUID().slice(0, 8),
    email = `account.${label}.${suffix}@example.test`;
  let authUserId: string | undefined;
  if (linked) {
    const signed = await auth.api.signUpEmail({
      body: { email, name: label, password: "Synthetic-account-fixture-9#" },
      asResponse: true,
    });
    const user = await db.user.update({
      where: { email },
      data: { emailVerified: true },
    });
    authUserId = user.id;
    cookie.set(
      email,
      signed.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
    );
  }
  const p = await db.person.create({
    data: {
      email,
      username: `acct.${label.slice(0, 10)}.${suffix}`,
      displayName: `Account ${label}`,
      role,
      status: "ACTIVE",
      employmentType: "EMPLOYEE",
      authUserId,
    },
  });
  ids.push(p.id);
  return p;
}
const mutation = (
  actor: Actor,
  op: string,
  input: unknown,
  fn: Parameters<typeof mutate>[4],
  key = crypto.randomUUID(),
) => mutate(actor, op, key, input, fn);
const edit = (
  actor: Actor,
  p: Actor,
  values: Partial<{
    displayName: string;
    username: string;
    employmentType: "EMPLOYEE" | "INTERN";
    expectedVersion: number;
  }> = {},
  key = crypto.randomUUID(),
) => {
  const input = profileSchema.parse({
    displayName: p.displayName,
    username: p.username,
    employmentType: p.employmentType,
    expectedVersion: p.version,
    ...values,
  });
  return mutation(
    actor,
    "profile:" + p.id,
    input,
    (tx) => editProfile(tx, actor, p.id, input),
    key,
  ) as Promise<{ id: string; version: number }>;
};
beforeAll(async () => {
  root = await person("root", "SUPER_ADMIN");
  other = await person("other", "SUPER_ADMIN");
  hr = await person("hr", "HR_ADMIN");
  member = await person("member");
});
afterAll(async () => {
  await db.person.updateMany({
    where: { id: { in: ids } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("paginates and filters the administrative directory without truncating later accounts", async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  await db.person.createMany({
    data: Array.from({ length: 26 }, (_, n) => ({
      username: `page.${tag}.${String(n).padStart(2, "0")}`,
      email: `page.${tag}.${n}@example.test`,
      displayName: `Directory ${tag}`,
      status: "ACTIVE" as const,
      role: "MEMBER" as const,
    })),
  });
  const query = peopleQuerySchema.parse({ q: tag, role: "MEMBER" }),
    first = await listPeople(root, query),
    second = await listPeople(root, { ...query, page: 2 });
  const beyond = await listPeople(root, { ...query, page: 999 });
  expect(beyond.page).toBe(2);
  expect(beyond.items).toHaveLength(1);
  expect(first.total).toBe(26);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(1);
  expect(first.items.some((p) => p.id === second.items[0].id)).toBe(false);
  await db.person.update({
    where: { id: second.items[0].id },
    data: { status: "INACTIVE" },
  });
  expect((await listPeople(root, query)).total).toBe(25);
  expect((await listPeople(root, { ...query, status: "INACTIVE" })).total).toBe(
    1,
  );
  await db.person.updateMany({
    where: { username: { startsWith: `page.${tag}.` } },
    data: { status: "INACTIVE" },
  });
});
it("keeps profile/detail data private to Super Admin and omits provider identity/session fields", async () => {
  for (const actor of [hr, member]) {
    await expect(personDetail(actor, member.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      listPeople(actor, peopleQuerySchema.parse({})),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      edit(actor, member, { displayName: "Denied profile" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  const detail = await personDetail(root, member.id);
  const text = JSON.stringify(detail);
  for (const field of [
    "authUserId",
    "supabaseUserId",
    "password",
    "access_token",
    "session",
  ])
    expect(text).not.toContain(field);
  expect(detail.email).toBe(member.email);
});
it("normalizes editable fields, increments one version and records one atomic audit on replay", async () => {
  const target = await person("profile"),
    key = crypto.randomUUID();
  const result = await edit(
    root,
    target,
    {
      displayName: "  Updated name  ",
      username: "EDITED." + crypto.randomUUID().slice(0, 8).toUpperCase(),
      employmentType: "INTERN",
    },
    key,
  );
  const p = await db.person.findUniqueOrThrow({ where: { id: target.id } });
  expect(p.version).toBe(2);
  expect(p.displayName).toBe("Updated name");
  expect(p.username).toBe(p.username.toLowerCase());
  expect(p.email).toBe(target.email);
  expect(p.role).toBe("MEMBER");
  // Replay the exact normalized body rather than generating another username.
  const input = {
    expectedVersion: 1,
    displayName: p.displayName,
    username: p.username,
    employmentType: "INTERN" as const,
  };
  const replay = await mutation(
    root,
    "profile:" + target.id,
    input,
    (tx) => editProfile(tx, root, target.id, input),
    key,
  );
  expect(replay).toEqual(result);
  expect(
    await db.audit.count({
      where: { entityId: target.id, action: "PROFILE_UPDATED" },
    }),
  ).toBe(1);
  await expect(
    edit(root, target, { displayName: "Stale overwrite" }),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
});
it("does not reserve another person’s username or a live pending invitation username", async () => {
  const target = await person("reserved");
  await expect(
    edit(root, target, { username: member.username }),
  ).rejects.toMatchObject({ code: "DUPLICATE" });
  const reserved = `pending.${crypto.randomUUID().slice(0, 8)}`;
  await db.invitation.create({
    data: {
      email: `${reserved}@example.test`,
      username: reserved,
      displayName: "Pending account fixture",
      role: "MEMBER",
      employmentType: "EMPLOYEE",
      tokenHash: crypto.randomUUID(),
      invitedBy: root.id,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await expect(
    edit(root, target, { username: reserved }),
  ).rejects.toMatchObject({ code: "USERNAME_RESERVED" });
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: target.id } })).version,
  ).toBe(1);
});
it("treats an unchanged profile as a no-op without a new audit or version", async () => {
  const target = await person("unchanged");
  await edit(root, target);
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: target.id } })).version,
  ).toBe(1);
  expect(
    await db.audit.count({
      where: { entityId: target.id, action: "PROFILE_UPDATED" },
    }),
  ).toBe(0);
});
it("keeps sessions and versions unchanged when saving an identical role", async () => {
  const target = await person("same-role");
  const sessions = await db.session.count({
    where: { userId: target.authUserId! },
  });
  const value = await mutation(root, "same-role", {}, (tx) =>
    changeRole(tx, root, target.id, {
      expectedVersion: 1,
      role: "MEMBER",
      reason: "Review same access",
    }),
  );
  expect(value).toMatchObject({ version: 1 });
  expect(
    await db.session.count({ where: { userId: target.authUserId! } }),
  ).toBe(sessions);
  expect(
    await db.audit.count({
      where: { entityId: target.id, action: "ROLE_CHANGED" },
    }),
  ).toBe(0);
});
it("allows only one concurrent profile edit at the same version", async () => {
  const target = await person("concurrent");
  const results = await Promise.allSettled([
    edit(root, target, { displayName: "First proposed name" }),
    edit(other, target, { displayName: "Second proposed name" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: target.id } })).version,
  ).toBe(2);
});
it("serializes profile and security changes against the same optimistic version", async () => {
  const target = await person("mixed");
  const input = {
    expectedVersion: 1,
    role: "TEAM_LEAD" as const,
    reason: "Concurrent role fixture",
  };
  const results = await Promise.allSettled([
    edit(root, target, { displayName: "Concurrent profile fixture" }),
    mutation(other, "role:" + target.id, input, (tx) =>
      changeRole(tx, other, target.id, input),
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: target.id } })).version,
  ).toBe(2);
});
it("removes retained project-manager write privileges after a Team Lead is demoted", async () => {
  const lead = await person("demoted-lead", "TEAM_LEAD");
  const project = (await mutation(lead, "lead-project", {}, (tx) =>
    createProject(tx, lead, {
      name: "Demotion boundary fixture",
      description: "Keep membership and history",
    }),
  )) as { id: string };
  await mutation(root, "demote-lead", {}, (tx) =>
    changeRole(tx, root, lead.id, {
      expectedVersion: 1,
      role: "MEMBER",
      reason: "Verify least privilege after demotion",
    }),
  );
  const current = await db.person.findUniqueOrThrow({ where: { id: lead.id } });
  await expect(
    mutation(current, "denied-member-management", {}, (tx) =>
      addMember(tx, current, project.id, member.id),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await db.projectMember.count({
      where: { projectId: project.id, userId: lead.id },
    }),
  ).toBe(1);
  await mutation(root, "restore-lead-role", {}, (tx) =>
    changeRole(tx, root, lead.id, { expectedVersion: 2, role: "TEAM_LEAD" }),
  );
  const restored = await db.person.findUniqueOrThrow({
    where: { id: lead.id },
  });
  await expect(
    mutation(restored, "restored-manager", {}, (tx) =>
      addMember(tx, restored, project.id, member.id),
    ),
  ).resolves.toHaveProperty("userId", member.id);
});
it("deactivation/recovery preserves assigned work and restores only a linked account", async () => {
  const target = await person("lifecycle");
  const project = (await mutation(root, "new-project", {}, (tx) =>
    createProject(tx, root, {
      name: "Account lifecycle fixture",
      description: "Synthetic records retained",
    }),
  )) as { id: string };
  await mutation(root, "member", {}, (tx) =>
    addMember(tx, root, project.id, target.id),
  );
  await mutation(root, "task", {}, (tx) =>
    assign(tx, root, {
      projectId: project.id,
      assigneeId: target.id,
      reviewerId: root.id,
      title: "Retained account task",
      description: "Fixture",
      priority: "NORMAL",
    }),
  );
  expect((await personDetail(root, target.id)).openAssignments).toBe(1);
  const before = await db.task.findMany({ where: { projectId: project.id } });
  const stopped = (await mutation(root, "deactivate:" + target.id, {}, (tx) =>
    deactivate(tx, root, target.id, {
      expectedVersion: 1,
      reason: "Synthetic suspension",
    }),
  )) as { version: number };
  expect(stopped.version).toBe(2);
  expect(
    await db.session.count({ where: { userId: target.authUserId! } }),
  ).toBe(0);
  expect((await personDetail(root, target.id)).canReactivate).toBe(true);
  await expect(
    mutation(root, "stale-reactivation", {}, (tx) =>
      reactivate(tx, root, target.id, { expectedVersion: 1 }),
    ),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
  const restored = (await mutation(root, "reactivate:" + target.id, {}, (tx) =>
    reactivate(tx, root, target.id, {
      expectedVersion: 2,
      reason: "Restore synthetic access",
    }),
  )) as { version: number };
  expect(restored.version).toBe(3);
  expect(await db.task.findMany({ where: { projectId: project.id } })).toEqual(
    before,
  );
  const response = await auth.api.signInEmail({
    body: { email: target.email, password: "Synthetic-account-fixture-9#" },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  expect(
    (await personDetail(root, target.id)).history.map((e) => e.action),
  ).toEqual(
    expect.arrayContaining(["PERSON_DEACTIVATED", "PERSON_REACTIVATED"]),
  );
});
it("refuses activation without a sign-in identity and refuses a duplicate active transition", async () => {
  const target = await person("unlinked", "MEMBER", false);
  await db.person.update({
    where: { id: target.id },
    data: { status: "INACTIVE" },
  });
  expect((await personDetail(root, target.id)).canReactivate).toBe(false);
  await expect(
    mutation(root, "unlinked-reactivation", {}, (tx) =>
      reactivate(tx, root, target.id, { expectedVersion: 1 }),
    ),
  ).rejects.toMatchObject({ code: "IDENTITY_NOT_LINKED" });
  await expect(
    mutation(root, "already-active", {}, (tx) =>
      reactivate(tx, root, member.id, { expectedVersion: 1 }),
    ),
  ).rejects.toMatchObject({ code: "ACCOUNT_STATE" });
});
it("does not permit two administrators to deactivate one another concurrently", async () => {
  const a = await person("race-a", "SUPER_ADMIN"),
    b = await person("race-b", "SUPER_ADMIN");
  const results = await Promise.allSettled([
    mutation(a, "stop-b", {}, (tx) =>
      deactivate(tx, a, b.id, { expectedVersion: 1 }),
    ),
    mutation(b, "stop-a", {}, (tx) =>
      deactivate(tx, b, a.id, { expectedVersion: 1 }),
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.person.count({
      where: { id: { in: [a.id, b.id] }, status: "ACTIVE" },
    }),
  ).toBe(1);
});
it("protects self-access changes and rejects profile tampering and invalid list bounds", async () => {
  await expect(
    mutation(root, "self-role", {}, (tx) =>
      changeRole(tx, root, root.id, {
        expectedVersion: root.version,
        role: "MEMBER",
      }),
    ),
  ).rejects.toMatchObject({ code: "SELF_ROLE_CHANGE" });
  await expect(
    mutation(root, "self-stop", {}, (tx) =>
      deactivate(tx, root, root.id, { expectedVersion: root.version }),
    ),
  ).rejects.toMatchObject({ code: "SELF_DEACTIVATION" });
  const input = {
    expectedVersion: 1,
    displayName: "Safe",
    username: "safe.username",
    employmentType: "EMPLOYEE",
  };
  for (const field of ["email", "role", "status", "supabaseUserId"])
    expect(
      profileSchema.safeParse({ ...input, [field]: "untrusted" }).success,
    ).toBe(false);
  expect(peopleQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  expect(peopleQuerySchema.safeParse({ page: 10001 }).success).toBe(false);
});
it("enforces session, Origin, role and version boundaries on the new HTTP management endpoints", async () => {
  const { GET, POST, PATCH } = await import("@/app/api/v1/[...path]/route");
  const origin = process.env.APP_URL ?? process.env.BETTER_AUTH_URL!;
  const get = (path: string, actor?: Actor) =>
    GET(
      new Request(`${origin}/api/v1/${path}`, {
        headers: actor ? { cookie: cookie.get(actor.email)! } : {},
      }),
      { params: Promise.resolve({ path: path.split("?")[0].split("/") }) },
    );
  const write = (
    method: "POST" | "PATCH",
    path: string,
    actor: Actor,
    data: unknown,
    extra = {},
  ) =>
    (method === "PATCH" ? PATCH : POST)(
      new Request(`${origin}/api/v1/${path}`, {
        method,
        headers: {
          cookie: cookie.get(actor.email)!,
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
  const target = await person("http");
  expect((await get("people")).status).toBe(401);
  for (const actor of [hr, member]) {
    expect((await get("people", actor)).status).toBe(403);
    expect((await get("users/" + target.id, actor)).status).toBe(403);
    expect(
      (
        await write("POST", "users/" + target.id + "/reactivate", actor, {
          expectedVersion: 1,
        })
      ).status,
    ).toBe(403);
  }
  const response = await get("users/" + target.id, root);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const value = (await response.json()).data;
  expect(value.email).toBe(target.email);
  expect("supabaseUserId" in value).toBe(false);
  const input = {
    expectedVersion: 1,
    displayName: "HTTP profile",
    username: target.username,
    employmentType: "INTERN",
  };
  expect(
    (
      await write("PATCH", "users/" + target.id, root, input, {
        Origin: "https://foreign.example.test",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await write("PATCH", "users/" + target.id, root, {
        ...input,
        email: "replace@example.test",
      })
    ).status,
  ).toBe(422);
  expect((await write("PATCH", "users/" + target.id, root, input)).status).toBe(
    200,
  );
  expect((await write("PATCH", "users/" + target.id, root, input)).status).toBe(
    409,
  );
  expect(
    (
      await write("POST", "users/" + target.id + "/deactivate", root, {
        expectedVersion: 2,
        reason: "HTTP suspension",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await write("POST", "users/" + target.id + "/reactivate", root, {
        expectedVersion: 3,
        reason: "HTTP restoration",
      })
    ).status,
  ).toBe(200);
});
