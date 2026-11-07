import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createHash } from "node:crypto";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required.");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { acceptSupabaseInvitation } =
  await import("@/modules/identity/supabase-provisioning");
let adminId: string;
beforeAll(async () => {
  const unique = crypto.randomUUID().slice(0, 8);
  adminId = (
    await db.person.create({
      data: {
        username: `prov.${unique}`,
        email: `prov.${unique}@example.test`,
        displayName: "Provisioning fixture",
        role: "SUPER_ADMIN",
        status: "ACTIVE",
      },
    })
  ).id;
});
afterAll(async () => {
  await db.$disconnect();
});
async function invitation() {
  const token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", ""),
    suffix = crypto.randomUUID().slice(0, 8),
    email = `sup.${suffix}@example.test`;
  const record = await db.invitation.create({
    data: {
      email,
      username: `sup.${suffix}`,
      displayName: "Supabase fixture",
      role: "MEMBER",
      employmentType: "EMPLOYEE",
      invitedBy: adminId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    record,
    input: { token, email, password: "Synthetic-provider-fixture-only-8#" },
  };
}
it("links a provider identity only after the domain commit, preserving the separate IDs", async () => {
  const { record, input } = await invitation();
  const providerId = crypto.randomUUID();
  const result = await acceptSupabaseInvitation(input, {
    provision: async () => {
      expect(
        await db.person.count({ where: { supabaseUserId: providerId } }),
      ).toBe(0);
      return { id: providerId };
    },
  });
  const person = await db.person.findUniqueOrThrow({
    where: { id: result.id },
  });
  expect(person.supabaseUserId).toBe(providerId);
  expect(person.authUserId).toBeNull();
  expect(
    (await db.invitation.findUniqueOrThrow({ where: { id: record.id } }))
      .provisioningStatus,
  ).toBe("COMPLETE");
  await expect(
    acceptSupabaseInvitation(input, {
      provision: async () => ({ id: providerId }),
    }),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
});
it("does not hold a database transaction across provider HTTP and permits retry after failure", async () => {
  const { record, input } = await invitation();
  await expect(
    acceptSupabaseInvitation(input, {
      provision: async () => {
        await db.invitation.findUniqueOrThrow({ where: { id: record.id } });
        throw new Error("Ambiguous provider failure");
      },
    }),
  ).rejects.toThrow("Ambiguous provider failure");
  expect(await db.person.count({ where: { email: input.email } })).toBe(0);
  expect(
    (await db.invitation.findUniqueOrThrow({ where: { id: record.id } }))
      .provisioningStatus,
  ).toBe("PENDING");
  await expect(
    acceptSupabaseInvitation(input, {
      provision: async () => ({ id: crypto.randomUUID() }),
    }),
  ).resolves.toHaveProperty("id");
});
it("does not activate an identity when an invitation is revoked during provisioning", async () => {
  const { record, input } = await invitation();
  await expect(
    acceptSupabaseInvitation(input, {
      provision: async () => {
        await db.invitation.update({
          where: { id: record.id },
          data: { revokedAt: new Date() },
        });
        return { id: crypto.randomUUID() };
      },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  expect(await db.person.count({ where: { email: input.email } })).toBe(0);
});
it("rejects expired invitations before calling the provider", async () => {
  const { record, input } = await invitation();
  await db.invitation.update({
    where: { id: record.id },
    data: { expiresAt: new Date(0) },
  });
  let called = false;
  await expect(
    acceptSupabaseInvitation(input, {
      provision: async () => {
        called = true;
        return { id: crypto.randomUUID() };
      },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  expect(called).toBe(false);
});
it("serializes concurrent acceptance attempts without creating two identities", async () => {
  const { input } = await invitation();
  let unblock!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    wait = new Promise<void>((r) => {
      unblock = r;
    });
  const first = acceptSupabaseInvitation(input, {
    provision: async () => {
      entered();
      await wait;
      return { id: crypto.randomUUID() };
    },
  });
  await started;
  try {
    await expect(
      acceptSupabaseInvitation(input, {
        provision: async () => ({ id: crypto.randomUUID() }),
      }),
    ).rejects.toMatchObject({ code: "PROVISIONING_BUSY" });
  } finally {
    unblock();
  }
  await first;
  expect(await db.person.count({ where: { email: input.email } })).toBe(1);
});
