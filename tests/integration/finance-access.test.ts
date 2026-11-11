import "dotenv/config";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, it, expect } from "vitest";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required.");
process.env.DATABASE_URL = url;
process.env.FINANCE_ENABLED = "true";
const { db } = await import("@/server/db");
const { env } = await import("@/server/env");
const {
  financeStatus,
  hasFinanceAccess,
  withFinanceAccess,
  requireFinanceAccess,
} = await import("@/modules/finance/access/policy");
const { GET } = await import("@/app/api/v1/finance/status/route");
const { profileSchema, roleSchema } = await import("@/modules/people/schemas");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {};
const cookies: Record<string, string> = {};
const originalFlag = env.FINANCE_ENABLED;
const request = (label?: string) =>
  new Request("http://localhost:3000/api/v1/finance/status", {
    headers: label ? { cookie: cookies[label] } : {},
  });
beforeAll(async () => {
  env.FINANCE_ENABLED = true;
  const auth = betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  const suffix = crypto.randomUUID().slice(0, 8);
  for (const [label, role] of [
    ["selected", "SUPER_ADMIN"],
    ["unselected", "SUPER_ADMIN"],
    ["hr", "HR_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
  ] as const) {
    const email = `finance.${label}.${suffix}@example.test`;
    const signed = await auth.api.signUpEmail({
      body: { email, name: label, password: "Synthetic-finance-test-only-9#" },
      asResponse: true,
    });
    const user = await db.user.update({
      where: { email },
      data: { emailVerified: true },
    });
    people[label] = await db.person.create({
      data: {
        email,
        username: `finance.${label}.${suffix}`,
        displayName: label,
        role,
        status: "ACTIVE",
        authUserId: user.id,
      },
    });
    cookies[label] = signed.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
  }
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.selected.id,
      reason: "Isolated finance access fixture",
    },
  });
  // Rehearse hosted privileges, including applying setup twice without widening them.
  const setup = await readFile("supabase/setup.sql", "utf8");
  for (let i = 0; i < 2; i++) {
    // pg supports the multi-statement operator setup; Prisma prepared SQL does not.
    const { Client } = (await import("pg")).default;
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(`DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      END $$;`);
      await client.query(setup);
    } finally {
      await client.end();
    }
  }
});
afterAll(async () => {
  env.FINANCE_ENABLED = originalFlag;
  await db.financeGrant.deleteMany({
    where: { userId: { in: Object.values(people).map((p) => p.id) } },
  });
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});

it("denies Member, HR, Lead and unselected Super Admin in shared queries and HTTP", async () => {
  for (const label of ["member", "hr", "lead", "unselected"]) {
    await expect(financeStatus(people[label])).rejects.toMatchObject({
      code: "FINANCE_FORBIDDEN",
      status: 403,
    });
    expect(await hasFinanceAccess(people[label])).toBe(false);
    const result = await GET(request(label));
    expect(result.status).toBe(403);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(await result.json()).toMatchObject({
      error: { code: "FINANCE_FORBIDDEN", requestId: expect.any(String) },
    });
  }
});
it("requires a verified session and returns only a minimal selected-admin status", async () => {
  const anonymous = await GET(request());
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("cache-control")).toContain("no-store");
  const selected = await GET(request("selected"));
  expect(selected.status).toBe(200);
  expect(selected.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(await selected.json()).toEqual({
    data: { currency: "PKR", stage: "ACCESS_FOUNDATION" },
  });
});
it("defaults to denial when finance is disabled even for a selected admin", async () => {
  env.FINANCE_ENABLED = false;
  try {
    expect(await hasFinanceAccess(people.selected)).toBe(false);
    await expect(financeStatus(people.selected)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    const response = await GET(request("selected"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("does not trust a stale actor role or an explicit grant on a non-admin account", async () => {
  for (const label of ["hr", "lead", "member"]) {
    await db.financeGrant.create({
      data: {
        userId: people[label].id,
        grantedById: people.selected.id,
        reason: "Invalid role test fixture",
      },
    });
    const forgedActor = { ...people[label], role: "SUPER_ADMIN" as const };
    await expect(financeStatus(forgedActor)).rejects.toMatchObject({
      status: 403,
    });
  }
});
it("rereads account status and role instead of retaining a prior authorization", async () => {
  for (const data of [
    { status: "INACTIVE" as const },
    { role: "MEMBER" as const },
  ]) {
    await db.person.update({ where: { id: people.selected.id }, data });
    try {
      await expect(financeStatus(people.selected)).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await db.person.update({
        where: { id: people.selected.id },
        data: { status: "ACTIVE", role: "SUPER_ADMIN" },
      });
    }
  }
});
it("denies the next request and delayed work after a grant is revoked", async () => {
  expect(await hasFinanceAccess(people.selected)).toBe(true);
  const grant = await db.financeGrant.findFirstOrThrow({
    where: { userId: people.selected.id, revokedAt: null },
  });
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${people.selected.id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(629813, hashtext(${people.selected.id}))`;
    await tx.financeGrant.update({
      where: { id: grant.id },
      data: { revokedById: people.selected.id, revokedAt: new Date() },
    });
  });
  try {
    let ran = false;
    await expect(
      withFinanceAccess(people.selected, async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(ran).toBe(false);
    expect((await GET(request("selected"))).status).toBe(403);
  } finally {
    await db.financeGrant.update({
      where: { id: grant.id },
      data: { revokedById: null, revokedAt: null },
    });
  }
});
it("holds the grant lock through the protected query and releases it at transaction end", async () => {
  await withFinanceAccess(people.selected, async () => {
    const result = await db.$transaction(
      (tx) => tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(629813, hashtext(${people.selected.id})) AS locked
    `,
    );
    expect(result[0].locked).toBe(false);
  });
  const after = await db.$transaction(
    (tx) => tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(629813, hashtext(${people.selected.id})) AS locked
  `,
  );
  expect(after[0].locked).toBe(true);
});
it("enforces one active grant, paired revocation and foreign-key retention", async () => {
  await expect(
    db.financeGrant.create({
      data: {
        userId: people.selected.id,
        grantedById: people.selected.id,
        reason: "Duplicate active grant",
      },
    }),
  ).rejects.toMatchObject({ code: "P2002" });
  const grant = await db.financeGrant.findFirstOrThrow({
    where: { userId: people.selected.id, revokedAt: null },
  });
  await expect(
    db.financeGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    }),
  ).rejects.toThrow();
  await expect(
    db.person.delete({ where: { id: people.selected.id } }),
  ).rejects.toMatchObject({ code: "P2003" });
});
it("generic People schemas reject grants and ownership injection", () => {
  expect(
    roleSchema.safeParse({
      expectedVersion: 1,
      role: "SUPER_ADMIN",
      financeGrant: true,
    }).success,
  ).toBe(false);
  expect(
    profileSchema.safeParse({
      expectedVersion: 1,
      displayName: "Test",
      username: "test",
      employmentType: "EMPLOYEE",
      financeOwner: true,
    }).success,
  ).toBe(false);
});
it("runtime can authorize reads but cannot create, revoke or delete a finance grant", async () => {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE encova_app");
    await requireFinanceAccess(tx, people.selected);
  });
  for (const sql of [
    'DELETE FROM "FinanceGrant"',
    'UPDATE "FinanceGrant" SET "revokedAt"=CURRENT_TIMESTAMP',
    'INSERT INTO "FinanceGrant" (id) VALUES (gen_random_uuid())',
  ]) {
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE encova_app");
        await tx.$executeRawUnsafe(sql);
      }),
    ).rejects.toMatchObject({
      meta: expect.objectContaining({ driverAdapterError: expect.anything() }),
    });
  }
});
it("finance audit is append-only and absent from the ordinary ERP audit", async () => {
  const id = crypto.randomUUID();
  await db.financeAuditEvent.create({
    data: {
      id,
      actorId: people.selected.id,
      action: "TEST_ACCESS",
      entityType: "FinanceGrant",
      reason: "Isolated audit evidence",
      data: { fixture: true },
      requestId: crypto.randomUUID(),
    },
  });
  expect(await db.audit.count({ where: { entityId: id } })).toBe(0);
  await expect(
    db.financeAuditEvent.update({
      where: { id },
      data: { reason: "Attempted modification" },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeAuditEvent.delete({ where: { id } }),
  ).rejects.toThrow();
});
it("Data API roles cannot read finance grants or audit history", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["FinanceGrant", "FinanceAuditEvent"]) {
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          await tx.$queryRawUnsafe(`SELECT * FROM "${table}"`);
        }),
      ).rejects.toThrow();
    }
  }
});
