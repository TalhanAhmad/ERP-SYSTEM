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
const { invite, listInvitations, manageInvitationAction, acceptInvitation } =
  await import("@/modules/identity/service");
const { acceptSupabaseInvitation } =
  await import("@/modules/identity/supabase-provisioning");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let admin: Actor, hr: Actor, member: Actor;
beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  for (const [name, role] of [
    ["owner", "SUPER_ADMIN"],
    ["hr", "HR_ADMIN"],
    ["member", "MEMBER"],
  ] as const) {
    const p = await db.person.create({
      data: {
        username: `inv.${name}.${suffix}`,
        email: `inv.${name}.${suffix}@example.test`,
        displayName: name,
        role,
        status: "ACTIVE",
      },
    });
    if (name === "owner") admin = p;
    else if (name === "hr") hr = p;
    else member = p;
  }
});
afterAll(async () => {
  await db.$disconnect();
});
async function create(role: "MEMBER" | "SUPER_ADMIN" = "MEMBER") {
  const suffix = crypto.randomUUID().slice(0, 8);
  const input = {
    email: `invite.${suffix}@example.test`,
    username: `invite.${suffix}`,
    displayName: "Synthetic invitation",
    role,
    employmentType: "EMPLOYEE" as const,
  };
  const record = (await mutate(
    admin,
    "invitations",
    crypto.randomUUID(),
    input,
    (tx) => invite(tx, admin, input),
  )) as { id: string };
  const mail = await db.outbox.findFirstOrThrow({
    where: { invitationId: record.id },
  });
  const token = mail.text.match(/\/invite\/([a-f0-9]{64})/)![1];
  return {
    id: record.id,
    mail,
    input: {
      token,
      email: input.email,
      password: "Synthetic-invitation-fixture-9#",
    },
  };
}
const act = (
  actor: Actor,
  id: string,
  action: "resend" | "revoke",
  expectedVersion = 1,
  key = crypto.randomUUID(),
) =>
  mutate(actor, `invitations/${id}/${action}`, key, { expectedVersion }, (tx) =>
    manageInvitationAction(tx, actor, id, { action, expectedVersion }),
  );
it("limits invitation metadata to admins, hides privileged invitations from HR, and excludes bearer credentials", async () => {
  const item = await create("SUPER_ADMIN");
  await expect(listInvitations(member)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect((await listInvitations(hr)).some((x) => x.id === item.id)).toBe(false);
  const row = (await listInvitations(admin)).find((x) => x.id === item.id)!;
  expect(row).toMatchObject({
    status: "PENDING",
    delivery: "QUEUED",
    version: 1,
  });
  expect(JSON.stringify(row)).not.toContain(item.input.token);
  expect(row).not.toHaveProperty("tokenHash");
  expect(row).not.toHaveProperty("provisioningAttemptId");
});
it("resends atomically, cancels old queued mail and rejects the old token in both providers", async () => {
  const item = await create();
  await act(admin, item.id, "resend");
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: item.mail.id } }))
      .canceledAt,
  ).toBeTruthy();
  expect(
    await db.outbox.count({
      where: { invitationId: item.id, canceledAt: null },
    }),
  ).toBe(1);
  await expect(acceptInvitation(item.input)).rejects.toMatchObject({
    code: "INVALID_INVITATION",
  });
  await expect(
    acceptSupabaseInvitation(item.input, {
      provision: async () => {
        throw new Error("Provider must not be called");
      },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  expect(
    await db.audit.count({
      where: { entityId: item.id, action: "INVITATION_RESENT" },
    }),
  ).toBe(1);
});
it("replays a retry without rotating again and rejects stale concurrent changes", async () => {
  const item = await create(),
    key = crypto.randomUUID();
  const first = await act(admin, item.id, "resend", 1, key);
  expect(await act(admin, item.id, "resend", 1, key)).toEqual(first);
  await expect(act(admin, item.id, "revoke", 1)).rejects.toMatchObject({
    code: "STALE_VERSION",
  });
  expect(await db.outbox.count({ where: { invitationId: item.id } })).toBe(2);
});
it("permits just one winner when two administrators resend the same version", async () => {
  const item = await create();
  const results = await Promise.allSettled([
    act(admin, item.id, "resend"),
    act(hr, item.id, "resend"),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  expect(
    await db.outbox.count({
      where: { invitationId: item.id, canceledAt: null },
    }),
  ).toBe(1);
});
it("prevents HR escalation and member mutations without partial cancellation", async () => {
  const privileged = await create("SUPER_ADMIN"),
    ordinary = await create();
  for (const action of ["resend", "revoke"] as const) {
    await expect(act(hr, privileged.id, action)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(act(member, ordinary.id, action)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  }
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: privileged.mail.id } }))
      .canceledAt,
  ).toBeNull();
});
it("rejects expired and revoked tokens before any provider call, and never revives a revoked invite", async () => {
  const item = await create();
  await db.invitation.update({
    where: { id: item.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(acceptInvitation(item.input)).rejects.toMatchObject({
    code: "INVALID_INVITATION",
  });
  await act(hr, item.id, "resend"); // An expired pending invitation can receive a new 72-hour link.
  const latest = await db.outbox.findFirstOrThrow({
    where: { invitationId: item.id, canceledAt: null },
  });
  const token = latest.text.match(/\/invite\/([a-f0-9]{64})/)![1];
  await act(hr, item.id, "revoke", 2);
  await expect(
    acceptInvitation({ ...item.input, token }),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  await expect(
    acceptSupabaseInvitation(
      { ...item.input, token },
      {
        provision: async () => {
          throw new Error("Provider must not be called");
        },
      },
    ),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  await expect(act(admin, item.id, "resend", 3)).rejects.toMatchObject({
    code: "INVITATION_CLOSED",
  });
});
it("allows only the replacement token to accept once and closes management afterward", async () => {
  const item = await create();
  await act(admin, item.id, "resend");
  const mail = await db.outbox.findFirstOrThrow({
    where: { invitationId: item.id, canceledAt: null },
  });
  const token = mail.text.match(/\/invite\/([a-f0-9]{64})/)![1];
  await acceptSupabaseInvitation(
    { ...item.input, token },
    { provision: async () => ({ id: crypto.randomUUID() }) },
  );
  await expect(act(admin, item.id, "resend", 3)).rejects.toMatchObject({
    code: "INVITATION_CLOSED",
  });
  await expect(
    acceptSupabaseInvitation(
      { ...item.input, token },
      { provision: async () => ({ id: crypto.randomUUID() }) },
    ),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
});
it("blocks resend during provider provisioning but lets revocation prevent domain activation", async () => {
  const item = await create();
  await expect(
    acceptSupabaseInvitation(item.input, {
      provision: async () => {
        await expect(act(admin, item.id, "resend")).rejects.toMatchObject({
          code: "PROVISIONING_BUSY",
        });
        await act(admin, item.id, "revoke");
        return { id: crypto.randomUUID() };
      },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  expect(await db.person.count({ where: { email: item.input.email } })).toBe(0);
});
it("serves safe invitation metadata and enforces HTTP origin/session/version boundaries", async () => {
  const { betterAuth } = await import("better-auth");
  const { prismaAdapter } = await import("better-auth/adapters/prisma");
  const provisioner = betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  const result = await provisioner.api.signUpEmail({
    body: {
      email: admin.email,
      name: admin.displayName,
      password: "Synthetic-http-fixture-9#",
    },
    asResponse: true,
  });
  const identity = await db.user.findUniqueOrThrow({
    where: { email: admin.email },
  });
  await db.user.update({
    where: { id: identity.id },
    data: { emailVerified: true },
  });
  await db.person.update({
    where: { id: admin.id },
    data: { authUserId: identity.id },
  });
  const cookie = result.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  const { GET, POST } = await import("@/app/api/v1/[...path]/route");
  const item = await create();
  const origin = process.env.APP_URL ?? process.env.BETTER_AUTH_URL!;
  const headers = {
    cookie,
    Origin: new URL(origin).origin,
    "Content-Type": "application/json",
    "X-Encova-CSRF": "1",
    "Idempotency-Key": crypto.randomUUID(),
  };
  const request = () =>
    new Request(`${origin}/api/v1/invitations`, { headers: { cookie } });
  expect(
    (
      await GET(new Request(`${origin}/api/v1/invitations`), {
        params: Promise.resolve({ path: ["invitations"] }),
      })
    ).status,
  ).toBe(401);
  const list = await GET(request(), {
    params: Promise.resolve({ path: ["invitations"] }),
  });
  expect(list.status).toBe(200);
  expect(JSON.stringify(await list.json())).not.toContain(item.input.token);
  const params = {
    params: Promise.resolve({ path: ["invitations", item.id, "resend"] }),
  };
  expect(
    (
      await POST(
        new Request(`${origin}/api/v1/invitations/${item.id}/resend`, {
          method: "POST",
          headers: { ...headers, Origin: "https://foreign.example.test" },
          body: JSON.stringify({ expectedVersion: 1 }),
        }),
        params,
      )
    ).status,
  ).toBe(403);
  const invoke = (data: unknown) =>
    POST(
      new Request(`${origin}/api/v1/invitations/${item.id}/resend`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(data),
      }),
      params,
    );
  expect((await invoke({})).status).toBe(422);
  expect((await invoke({ expectedVersion: 1 })).status).toBe(200);
  expect((await invoke({ expectedVersion: 1 })).status).toBe(409);
});
