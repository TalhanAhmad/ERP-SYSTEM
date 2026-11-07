import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
// Services use the same module singleton; configure its URL before importing it.
const testUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(testUrl).pathname !== "/encova_test")
  throw new Error(
    "Integration tests require a dedicated encova_test database.",
  );
process.env.DATABASE_URL = testUrl;
const { db } = await import("@/server/db");
const { mutate } = await import("@/server/transaction");
const { createProject, addMember } = await import("@/modules/projects/service");
const { assign, changeStatus, submit, review, listTasks } =
  await import("@/modules/tasks/service");
const { acceptInvitation, invite } = await import("@/modules/identity/service");
const { betterAuth } = await import("better-auth");
const { prismaAdapter } = await import("better-auth/adapters/prisma");
const { auth } = await import("@/server/auth");
const { GET, POST } = await import("@/app/api/v1/[...path]/route");
const independentDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testUrl }),
});
let admin: Awaited<ReturnType<typeof db.person.create>>,
  member: typeof admin,
  reviewer: typeof admin,
  outsider: typeof admin,
  hr: typeof admin;
let projectId: string, taskId: string, submissionId: string;
const key = () => crypto.randomUUID();
async function mutation(
  actor: typeof admin,
  operation: string,
  body: unknown,
  fn: Parameters<typeof mutate>[4],
) {
  return mutate(actor, operation, key(), body, fn);
}
async function createPerson(
  username: string,
  role: "SUPER_ADMIN" | "MEMBER" | "HR_ADMIN" = "MEMBER",
) {
  return db.person.create({
    data: {
      displayName: username,
      username,
      email: `${username}@example.test`,
      role,
      status: "ACTIVE",
    },
  });
}
beforeAll(async () => {
  // This database is explicitly isolated and contains synthetic fixtures only.
  await db.$executeRawUnsafe(
    'TRUNCATE "Idempotency","Audit","Notification","Review","Submission","Task","ProjectMember","Project","Invitation","Outbox","Person","session","account","verification","user","RateLimit","auth_rate_limit" CASCADE',
  );
  admin = await createPerson("admin", "SUPER_ADMIN");
  member = await createPerson("member");
  reviewer = await createPerson("reviewer");
  outsider = await createPerson("outsider");
  hr = await createPerson("hr.admin", "HR_ADMIN");
}, 30000);
afterAll(async () => {
  await db.$disconnect();
  await independentDb.$disconnect();
});
describe("Real PostgreSQL work lifecycle", () => {
  it("creates a project, membership, assignment and notification atomically", async () => {
    const p = (await mutation(admin, "project", {}, (tx) =>
      createProject(tx, admin, {
        name: "Synthetic project",
        description: "Integration fixture",
      }),
    )) as { id: string };
    projectId = p.id;
    for (const person of [member, reviewer])
      await mutation(admin, "member", { id: person.id }, (tx) =>
        addMember(tx, admin, projectId, person.id),
      );
    const t = (await mutation(admin, "assign", {}, (tx) =>
      assign(tx, admin, {
        projectId,
        assigneeId: member.id,
        reviewerId: reviewer.id,
        title: "Build a tested API",
        description: "Synthetic assignment",
        priority: "NORMAL",
      }),
    )) as { id: string };
    taskId = t.id;
    expect(
      await db.notification.count({ where: { recipientId: member.id } }),
    ).toBe(1);
  });
  it("denies unassigned project visibility", async () =>
    expect(await listTasks(outsider)).toHaveLength(0));
  it("rejects inactive and nonmember assignees", async () => {
    await expect(
      mutation(admin, "invalid", {}, (tx) =>
        assign(tx, admin, {
          projectId,
          assigneeId: outsider.id,
          reviewerId: reviewer.id,
          title: "Invalid",
          description: "",
          priority: "NORMAL",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_MEMBER" });
    expect(await db.task.count()).toBe(1);
  });
  it("preserves assignment IDs after a username change", async () => {
    await db.person.update({
      where: { id: member.id },
      data: { username: "renamed.member" },
    });
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).assigneeId,
    ).toBe(member.id);
  });
  it("denies nonassignee state changes", async () => {
    await expect(
      mutation(reviewer, "start", {}, (tx) =>
        changeStatus(tx, reviewer, taskId, {
          expectedVersion: 1,
          status: "IN_PROGRESS",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("accepts exactly one of two concurrent same-version edits", async () => {
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        mutation(member, "start", {}, (tx) =>
          changeStatus(tx, member, taskId, {
            expectedVersion: 1,
            status: "IN_PROGRESS",
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("creates an immutable submission and deduplicates concurrent retries", async () => {
    const body = {
      expectedVersion: 2,
      summary: "Initial implementation",
      artifactLinks: ["https://example.test/pr/1"],
    };
    const idem = key();
    const results = await Promise.all(
      [1, 2].map(() =>
        mutate(member, "submit", idem, body, (tx) =>
          submit(tx, member, taskId, body),
        ),
      ),
    );
    expect(results[0]).toEqual(results[1]);
    submissionId = (results[0] as { id: string }).id;
    expect(await db.submission.count({ where: { taskId } })).toBe(1);
    await expect(
      mutate(member, "submit", idem, { ...body, summary: "Different" }, (tx) =>
        submit(tx, member, taskId, body),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("prevents self-review even when actor has super-admin authority", async () => {
    const privileged = await db.person.update({
      where: { id: member.id },
      data: { role: "SUPER_ADMIN" },
    });
    await expect(
      mutation(privileged, "review", {}, (tx) =>
        review(tx, privileged, submissionId, {
          expectedVersion: 3,
          decision: "APPROVE",
          feedback: "",
        }),
      ),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    await db.person.update({
      where: { id: member.id },
      data: { role: "MEMBER" },
    });
  });
  it("returns work, preserves revision one and allows resubmission", async () => {
    await mutation(reviewer, "review", {}, (tx) =>
      review(tx, reviewer, submissionId, {
        expectedVersion: 3,
        decision: "REQUEST_CHANGES",
        feedback: "Add boundary tests.",
      }),
    );
    const s = (await mutation(member, "resubmit", {}, (tx) =>
      submit(tx, member, taskId, {
        expectedVersion: 4,
        summary: "Added boundary tests",
        artifactLinks: [],
      }),
    )) as { id: string };
    expect(await db.submission.count({ where: { taskId } })).toBe(2);
    await expect(
      mutation(reviewer, "old-review", {}, (tx) =>
        review(tx, reviewer, submissionId, {
          expectedVersion: 5,
          decision: "APPROVE",
          feedback: "",
        }),
      ),
    ).rejects.toMatchObject({ code: "REVIEW_RESOLVED" });
    submissionId = s.id;
  });
  it("allows one concurrent decision and locks approved work", async () => {
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        mutation(reviewer, "approve", {}, (tx) =>
          review(tx, reviewer, submissionId, {
            expectedVersion: 5,
            decision: "APPROVE",
            feedback: "Tests verified.",
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await db.task.findUniqueOrThrow({ where: { id: taskId } })).status,
    ).toBe("APPROVED");
    expect(await db.review.count({ where: { submissionId } })).toBe(1);
    await expect(
      mutation(member, "after-approval", {}, (tx) =>
        submit(tx, member, taskId, {
          expectedVersion: 6,
          summary: "Overwrite",
          artifactLinks: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
  it("rolls back partial changes including audits and idempotency", async () => {
    const before = await db.audit.count();
    await expect(
      mutation(admin, "rollback", {}, async (tx) => {
        await tx.audit.create({
          data: {
            actorId: admin.id,
            action: "ROLLBACK_FIXTURE",
            entityId: taskId,
            changes: {},
            requestId: key(),
          },
        });
        throw new Error("Synthetic failure");
      }),
    ).rejects.toThrow("Synthetic failure");
    expect(await db.audit.count()).toBe(before);
    expect(
      await db.idempotency.count({ where: { operation: "rollback" } }),
    ).toBe(0);
  });
  it("rejects a deactivated actor after context was resolved", async () => {
    await db.person.update({
      where: { id: outsider.id },
      data: { status: "INACTIVE" },
    });
    await expect(
      mutation(outsider, "inactive", {}, (tx) =>
        createProject(tx, outsider, { name: "Forbidden", description: "" }),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
  });
  it("cannot grant privileged invitations as HR", async () => {
    await expect(
      mutation(hr, "invite", {}, (tx) =>
        invite(tx, hr, {
          email: "privileged@example.test",
          username: "privileged",
          displayName: "Privileged",
          employmentType: "EMPLOYEE",
          role: "SUPER_ADMIN",
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("provisions invitation identity and active profile in one transaction", async () => {
    await mutation(admin, "invite", {}, (tx) =>
      invite(tx, admin, {
        email: "invited@example.test",
        username: "invited",
        displayName: "Invited User",
        employmentType: "EMPLOYEE",
        role: "MEMBER",
      }),
    );
    const mail = await db.outbox.findFirstOrThrow({
      where: { recipient: "invited@example.test" },
    });
    const token = mail.text.match(/invite\/([a-f0-9]{64})/)![1];
    const body = {
      token,
      email: "invited@example.test",
      password: "Synthetic-fixture-only-8#",
    };
    await expect(
      acceptInvitation({ ...body, email: "wrong@example.test" }),
    ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
    const result = await acceptInvitation(body);
    const person = await db.person.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(person.status).toBe("ACTIVE");
    expect(person.authUserId).toBeTruthy();
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: person.authUserId! } }))
        .emailVerified,
    ).toBe(true);
    await expect(acceptInvitation(body)).rejects.toMatchObject({
      code: "INVALID_INVITATION",
    });
  });
  it("blocks public sign-up through the real auth handler", async () => {
    const r = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          name: "Bypass",
          email: "bypass@example.test",
          password: "Synthetic-fixture-only-8#",
        }),
      }),
    );
    expect(r.ok).toBe(false);
    expect(
      await db.user.count({ where: { email: "bypass@example.test" } }),
    ).toBe(0);
  });
  it("rejects anonymous API requests and invalid mutation origins", async () => {
    const r = await GET(new Request("http://localhost:3000/api/v1/tasks"), {
      params: Promise.resolve({ path: ["tasks"] }),
    });
    expect(r.status).toBe(401);
    const mutation = await POST(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      { params: Promise.resolve({ path: ["projects"] }) },
    );
    expect(mutation.status).toBe(403);
  });
  it("rejects an unlinked auth identity and an inactive linked identity via direct API", async () => {
    const provisioner = betterAuth({
      database: prismaAdapter(db, { provider: "postgresql" }),
      secret: process.env.BETTER_AUTH_SECRET,
      emailAndPassword: { enabled: true },
    });
    const created = await provisioner.api.signUpEmail({
      body: {
        email: "unlinked@example.test",
        name: "Unlinked",
        password: "Synthetic-fixture-only-8#",
      },
      asResponse: true,
    });
    const cookie = created.headers.get("set-cookie")!;
    expect(cookie).toBeTruthy();
    const request = new Request("http://localhost:3000/api/v1/me", {
      headers: { cookie },
    });
    const denied = await GET(request, {
      params: Promise.resolve({ path: ["me"] }),
    });
    expect(denied.status).toBe(403);
    const identity = await db.user.findUniqueOrThrow({
      where: { email: "unlinked@example.test" },
    });
    await db.person.create({
      data: {
        authUserId: identity.id,
        email: identity.email,
        username: "inactive.linked",
        displayName: "Inactive fixture",
        status: "INACTIVE",
      },
    });
    const inactive = await GET(request, {
      params: Promise.resolve({ path: ["me"] }),
    });
    expect(inactive.status).toBe(403);
  });
});

it("denies HR role escalation and protects the last active super admin", async () => {
  const { changeRole, deactivate } = await import("@/modules/people/service");
  await expect(
    mutation(hr, "hr-escalation", {}, (tx) =>
      changeRole(tx, hr, reviewer.id, {
        expectedVersion: 1,
        role: "SUPER_ADMIN",
      }),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    mutation(admin, "last-demotion", {}, (tx) =>
      changeRole(tx, admin, admin.id, { expectedVersion: 1, role: "MEMBER" }),
    ),
  ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  await expect(
    mutation(admin, "last-deactivation", {}, (tx) =>
      deactivate(tx, admin, admin.id, { expectedVersion: 1 }),
    ),
  ).rejects.toMatchObject({ code: "LAST_ADMIN" });
});
it("revokes linked sessions immediately on deactivation", async () => {
  const { deactivate } = await import("@/modules/people/service");
  const provisioner = betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  const response = await provisioner.api.signUpEmail({
    body: {
      email: "deactivate.fixture@example.test",
      name: "Deactivation fixture",
      password: "Synthetic-fixture-only-8#",
    },
    asResponse: true,
  });
  const cookie = response.headers.get("set-cookie")!;
  const identity = await db.user.findUniqueOrThrow({
    where: { email: "deactivate.fixture@example.test" },
  });
  await db.user.update({
    where: { id: identity.id },
    data: { emailVerified: true },
  });
  const person = await db.person.create({
    data: {
      authUserId: identity.id,
      email: identity.email,
      username: "deactivate.fixture",
      displayName: "Deactivation fixture",
      status: "ACTIVE",
    },
  });
  const request = () =>
    new Request("http://localhost:3000/api/v1/me", { headers: { cookie } });
  expect(
    (await GET(request(), { params: Promise.resolve({ path: ["me"] }) }))
      .status,
  ).toBe(200);
  await mutation(admin, "deactivate", {}, (tx) =>
    deactivate(tx, admin, person.id, { expectedVersion: 1 }),
  );
  expect(await db.session.count({ where: { userId: identity.id } })).toBe(0);
  expect(
    (await GET(request(), { params: Promise.resolve({ path: ["me"] }) }))
      .status,
  ).toBe(401);
  expect(await db.task.count({ where: { id: taskId } })).toBe(1);
});
