import "dotenv/config";
import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import pg from "pg";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
process.env.FINANCE_ENABLED = "true";
const { db } = await import("@/server/db");
const { env } = await import("@/server/env");
const { verifyFinanceReauthentication } =
  await import("@/modules/finance/access/reauth");
const { setupOwner, accessCommand, financeAccessSnapshot } =
  await import("@/modules/finance/access/service");
const { financeStatus } = await import("@/modules/finance/access/policy");
const { accessMutation, accessRead } =
  await import("@/modules/finance/access/http");
const { grantSchema } = await import("@/modules/finance/access/schemas");
const { mutate } = await import("@/server/transaction");
const { deactivate, changeRole } = await import("@/modules/people/service");
const { synchronizeLoginEmail } = await import("@/server/login-email");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {};
const password = "Finance-fixture-only-9#";
const createAuth = () =>
  betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
let auth: ReturnType<typeof createAuth>;
const request = (name: string, body?: unknown) =>
  new Request("http://localhost:3000/api/v1/finance/access/grants", {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookies[name],
      origin: env.APP_URL,
      "x-encova-csrf": "1",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const proof = (name = "owner") =>
  verifyFinanceReauthentication(request(name), { password });
const settings = () => db.financeSettings.findFirstOrThrow();
async function command(
  name: string,
  action: Parameters<typeof accessCommand>[2],
  input: Parameters<typeof accessCommand>[3],
  key = crypto.randomUUID(),
) {
  const verified = await proof(name);
  return accessCommand(verified.actor, verified.proof, action, input, key);
}
const grant = async (name: string) =>
  command("owner", "GRANT", {
    targetId: people[name].id,
    expectedVersion: (await settings()).version,
    reason: "Explicit test selection",
  });
async function cleanupOwnedFinance() {
  const ids = Object.values(people).map((p) => p.id),
    current = await db.financeSettings.findFirst();
  if (current && !ids.includes(current.ownerId))
    throw new Error("Refuse to remove unowned finance setup");
  // Only this file's synthetic singleton is removed. Existing ERP records and
  // other finance grants are preserved; immutable audit/receipt history remains.
  if (current) await db.$executeRawUnsafe('TRUNCATE "FinanceSettings"');
  await db.financeOwnershipTransfer.deleteMany({
    where: { currentOwnerId: { in: ids } },
  });
  await db.financeGrant.deleteMany({ where: { userId: { in: ids } } });
}
beforeAll(async () => {
  env.FINANCE_ENABLED = true;
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(
      `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;`,
    );
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
  } finally {
    await sql.end();
  }
  auth = createAuth();
  const suffix = crypto.randomUUID().slice(0, 8);
  for (const name of ["owner", "target", "other", "member"]) {
    const email = `fin4.${name}.${suffix}@example.test`;
    const signed = await auth.api.signUpEmail({
      body: { email, name, password },
    });
    await db.user.update({
      where: { id: signed.user.id },
      data: { emailVerified: true },
    });
    people[name] = await db.person.create({
      data: {
        email,
        username: `fin4.${name}.${suffix}`,
        displayName: `Finance ${name}`,
        status: "ACTIVE",
        role: name === "member" ? "MEMBER" : "SUPER_ADMIN",
        authUserId: signed.user.id,
        supabaseUserId: crypto.randomUUID(),
      },
    });
  }
});
beforeEach(async () => {
  await cleanupOwnedFinance();
  for (const [name, person] of Object.entries(people)) {
    await db.person.update({
      where: { id: person.id },
      data: { status: "ACTIVE", role: person.role, email: person.email },
    });
    const signed = await auth.api.signInEmail({
      body: { email: person.email, password },
      asResponse: true,
    });
    cookies[name] = signed.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    await db.rateLimit.deleteMany({
      where: { id: { startsWith: `finance:reauth:${person.id}:` } },
    });
  }
  const verified = await proof();
  await setupOwner(
    verified.actor,
    verified.proof,
    people.owner.username,
    "Explicit isolated owner setup",
  );
});
afterAll(async () => {
  await cleanupOwnedFinance();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("keeps applied migration 19 immutable and uses additive validation migration 20", async () => {
  const row = await db.$queryRaw<
    { checksum: string }[]
  >`SELECT checksum FROM "_prisma_migrations" WHERE migration_name='20261111020000_finance_ownership' AND finished_at IS NOT NULL`;
  expect(row[0].checksum).toBe(
    createHash("sha256")
      .update(
        await readFile(
          "prisma/migrations/20261111020000_finance_ownership/migration.sql",
        ),
      )
      .digest("hex"),
  );
});
it("bootstraps one explicitly identified owner atomically under competing setup requests", async () => {
  await cleanupOwnedFinance();
  const a = await proof(),
    b = await proof("target");
  const results = await Promise.allSettled([
    setupOwner(a.actor, a.proof, people.owner.username, "Owner setup race"),
    setupOwner(b.actor, b.proof, people.target.username, "Owner setup race"),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const current = await settings();
  expect([people.owner.id, people.target.id]).toContain(current.ownerId);
  expect(
    await db.financeGrant.count({
      where: {
        userId: { in: [people.owner.id, people.target.id] },
        revokedAt: null,
      },
    }),
  ).toBe(1);
});
it("binds setup to the verified immutable identity and exact current username", async () => {
  await cleanupOwnedFinance();
  const verified = await proof();
  await expect(
    setupOwner(
      verified.actor,
      verified.proof,
      people.target.username,
      "Wrong owner binding",
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  expect(await db.financeSettings.count()).toBe(0);
  expect(
    await db.financeGrant.count({ where: { userId: people.owner.id } }),
  ).toBe(0);
});
it("requires real fresh password verification and refuses fabricated capabilities", async () => {
  await expect(
    verifyFinanceReauthentication(request("owner"), {
      password: "Incorrect-fixture-password",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_REAUTH_REQUIRED" });
  await expect(
    accessCommand(
      people.owner,
      {} as never,
      "GRANT",
      {
        targetId: people.target.id,
        expectedVersion: 1,
        reason: "Forged client proof",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_REAUTH_REQUIRED" });
  const verified = await proof();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 301000);
  try {
    await expect(
      accessCommand(
        people.owner,
        verified.proof,
        "GRANT",
        {
          targetId: people.target.id,
          expectedVersion: 1,
          reason: "Expired proof",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FINANCE_REAUTH_REQUIRED" });
  } finally {
    vi.useRealTimers();
  }
});
it("permits only the current owner to grant and rejects lower-role targets", async () => {
  await grant("target");
  await expect(
    command("target", "GRANT", {
      targetId: people.other.id,
      expectedVersion: (await settings()).version,
      reason: "Selected admin escalation",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_REQUIRED", status: 403 });
  await expect(
    command("owner", "GRANT", {
      targetId: people.member.id,
      expectedVersion: (await settings()).version,
      reason: "Invalid role target",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_TARGET_INELIGIBLE" });
  expect((await financeAccessSnapshot(people.target)).canManage).toBe(false);
  expect((await financeAccessSnapshot(people.owner)).canManage).toBe(true);
});
it("serializes duplicate grants and keeps a permanent restricted receipt without credentials", async () => {
  const key = crypto.randomUUID(),
    body = {
      targetId: people.target.id,
      expectedVersion: (await settings()).version,
      reason: "Concurrent explicit grant",
    };
  const results = await Promise.all([
    command("owner", "GRANT", body, key),
    command("owner", "GRANT", body, key),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    await db.financeGrant.count({
      where: { userId: people.target.id, revokedAt: null },
    }),
  ).toBe(1);
  expect(
    await db.financeAuditEvent.count({
      where: { entityId: results[0].id, action: "FINANCE_GRANT" },
    }),
  ).toBe(1);
  await expect(
    command("owner", "GRANT", { ...body, targetId: people.other.id }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  const receipt = await db.financeAccessReceipt.findFirstOrThrow({
    where: { actorId: people.owner.id, key },
  });
  expect(JSON.stringify(receipt)).not.toContain(password);
  expect(JSON.stringify(receipt)).not.toContain(cookies.owner);
  expect(
    await db.idempotency.count({ where: { actorId: people.owner.id, key } }),
  ).toBe(0);
});
it("rejects stale versions, existing grants and input that bypasses draft version validation", async () => {
  const version = (await settings()).version;
  await grant("target");
  await expect(
    command("owner", "GRANT", {
      targetId: people.other.id,
      expectedVersion: version,
      reason: "Stale selection",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await expect(grant("target")).rejects.toMatchObject({
    code: "FINANCE_ALREADY_GRANTED",
  });
  await expect(
    command("owner", "GRANT", {
      targetId: people.other.id,
      reason: "Missing version",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVALID_INPUT" });
});
it("keeps the old owner until the intended target accepts with fresh authentication", async () => {
  await grant("target");
  const transfer = await command("owner", "TRANSFER", {
    targetId: people.target.id,
    expectedVersion: (await settings()).version,
    reason: "Explicit transfer request",
  });
  expect((await settings()).ownerId).toBe(people.owner.id);
  await expect(
    command("owner", "ACCEPT", {
      transferId: transfer.id,
      expectedVersion: 1,
      reason: "Wrong accepting user",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  const key = crypto.randomUUID(),
    accept = {
      transferId: transfer.id,
      expectedVersion: 1,
      reason: "I accept responsibility",
    };
  await command("target", "ACCEPT", accept, key);
  expect((await settings()).ownerId).toBe(people.target.id);
  await command("target", "ACCEPT", accept, key);
  expect((await financeAccessSnapshot(people.owner)).canManage).toBe(false);
  await expect(grant("other")).rejects.toMatchObject({
    code: "FINANCE_OWNER_REQUIRED",
  });
});
it("supports cancellation and rejects canceled or expired acceptance", async () => {
  await grant("target");
  const first = await command("owner", "TRANSFER", {
    targetId: people.target.id,
    expectedVersion: (await settings()).version,
    reason: "Cancelable transfer",
  });
  await command("owner", "CANCEL", {
    transferId: first.id,
    expectedVersion: 1,
    reason: "Keep current ownership",
  });
  await expect(
    command("target", "ACCEPT", {
      transferId: first.id,
      expectedVersion: 1,
      reason: "Accept canceled transfer",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_TRANSFER_INVALID" });
  const second = await command("owner", "TRANSFER", {
    targetId: people.target.id,
    expectedVersion: (await settings()).version,
    reason: "Expiring transfer fixture",
  });
  await db.financeOwnershipTransfer.update({
    where: { id: second.id },
    data: {
      createdAt: new Date(Date.now() - 172800000),
      expiresAt: new Date(Date.now() - 86400000),
    },
  });
  await expect(
    command("target", "ACCEPT", {
      transferId: second.id,
      expectedVersion: 1,
      reason: "Expired transfer attempt",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_TRANSFER_INVALID" });
  expect((await settings()).ownerId).toBe(people.owner.id);
});
it("revokes selected access immediately and cannot revoke the current owner's grant", async () => {
  const granted = await grant("target");
  await command("owner", "REVOKE", {
    grantId: granted.id,
    grantVersion: 1,
    expectedVersion: (await settings()).version,
    reason: "End test selection",
  });
  await expect(financeStatus(people.target)).rejects.toMatchObject({
    status: 403,
  });
  const owner = await settings();
  await expect(
    command("owner", "REVOKE", {
      grantId: owner.ownerGrantId,
      grantVersion: 1,
      expectedVersion: owner.version,
      reason: "Try owner revocation",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_PROTECTED" });
});
it("blocks owner deletion, demotion, deactivation and grant removal even with the feature disabled", async () => {
  const owner = await settings();
  await expect(
    mutate(
      people.other,
      `users/${people.owner.id}/deactivate`,
      crypto.randomUUID(),
      {},
      (tx) =>
        deactivate(tx, people.other, people.owner.id, {
          expectedVersion: people.owner.version,
        }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_PROTECTED" });
  await expect(
    mutate(
      people.other,
      `users/${people.owner.id}/role`,
      crypto.randomUUID(),
      {},
      (tx) =>
        changeRole(tx, people.other, people.owner.id, {
          expectedVersion: people.owner.version,
          role: "MEMBER",
        }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_PROTECTED" });
  env.FINANCE_ENABLED = false;
  try {
    const { POST } = await import("@/app/api/v1/[...path]/route");
    const response = await POST(
      request("other", {
        expectedVersion: (
          await db.person.findUniqueOrThrow({ where: { id: people.owner.id } })
        ).version,
        reason: "Feature-off owner protection",
      }),
      {
        params: Promise.resolve({
          path: ["users", people.owner.id, "deactivate"],
        }),
      },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("FINANCE_OWNER_PROTECTED");
    await expect(
      db.person.update({
        where: { id: people.owner.id },
        data: { status: "INACTIVE" },
      }),
    ).rejects.toThrow();
    await expect(
      db.person.update({
        where: { id: people.owner.id },
        data: { role: "MEMBER" },
      }),
    ).rejects.toThrow();
    await expect(
      db.person.delete({ where: { id: people.owner.id } }),
    ).rejects.toThrow();
    await expect(
      db.financeGrant.delete({ where: { id: owner.ownerGrantId } }),
    ).rejects.toThrow();
    await expect(
      db.financeSettings.delete({ where: { id: owner.id } }),
    ).rejects.toThrow();
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("protects identity bindings while allowing verified self-service email synchronization", async () => {
  await expect(
    db.person.update({
      where: { id: people.owner.id },
      data: { email: "takeover@example.test" },
    }),
  ).rejects.toThrow();
  await expect(
    db.person.update({
      where: { id: people.owner.id },
      data: { supabaseUserId: crypto.randomUUID() },
    }),
  ).rejects.toThrow();
  const changed = await db.$transaction((tx) =>
    synchronizeLoginEmail(
      tx,
      people.owner,
      {
        id: people.owner.supabaseUserId!,
        email: `self.${people.owner.email}`,
        email_confirmed_at: new Date().toISOString(),
      } as never,
      crypto.randomUUID(),
    ),
  );
  expect(changed.id).toBe(people.owner.id);
  expect(changed.email).toBe(`self.${people.owner.email}`);
  expect((await settings()).ownerId).toBe(people.owner.id);
});
it("rechecks current sessions after reauthentication before mutating", async () => {
  const verified = await proof();
  await db.session.deleteMany({ where: { userId: people.owner.authUserId! } });
  await expect(
    accessCommand(
      people.owner,
      verified.proof,
      "GRANT",
      {
        targetId: people.target.id,
        expectedVersion: (await settings()).version,
        reason: "Revoked session race",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  expect(
    await db.financeGrant.count({
      where: { userId: people.target.id, revokedAt: null },
    }),
  ).toBe(0);
});
it("keeps one valid owner when transfer acceptance competes with revoking the target", async () => {
  const selected = await grant("target");
  const transfer = await command("owner", "TRANSFER", {
    targetId: people.target.id,
    expectedVersion: (await settings()).version,
    reason: "Transfer versus revoke",
  });
  const version = (await settings()).version;
  const results = await Promise.allSettled([
    command("target", "ACCEPT", {
      transferId: transfer.id,
      expectedVersion: 1,
      reason: "Concurrent acceptance",
    }),
    command("owner", "REVOKE", {
      grantId: selected.id,
      grantVersion: 1,
      expectedVersion: version,
      reason: "Concurrent revocation",
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const current = await settings();
  expect(
    await db.financeGrant.count({
      where: {
        id: current.ownerGrantId,
        userId: current.ownerId,
        revokedAt: null,
      },
    }),
  ).toBe(1);
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: current.ownerId } }))
      .status,
  ).toBe("ACTIVE");
});
it("serializes generic deactivation with transfer acceptance without leaving an inactive owner", async () => {
  await grant("target");
  const transfer = await command("owner", "TRANSFER", {
    targetId: people.target.id,
    expectedVersion: (await settings()).version,
    reason: "Transfer and account race",
  });
  const version = (
    await db.person.findUniqueOrThrow({ where: { id: people.owner.id } })
  ).version;
  const results = await Promise.allSettled([
    command("target", "ACCEPT", {
      transferId: transfer.id,
      expectedVersion: 1,
      reason: "Accept before status change",
    }),
    mutate(
      people.other,
      `users/${people.owner.id}/deactivate`,
      crypto.randomUUID(),
      {},
      (tx) =>
        deactivate(tx, people.other, people.owner.id, {
          expectedVersion: version,
        }),
    ),
  ]);
  expect(results[0].status).toBe("fulfilled");
  const current = await settings();
  expect(current.ownerId).toBe(people.target.id);
  expect(
    (await db.person.findUniqueOrThrow({ where: { id: current.ownerId } }))
      .status,
  ).toBe("ACTIVE");
});
it("runtime can use only the audited command, not bootstrap or direct grant/settings writes", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    for (const query of [
      'UPDATE "FinanceSettings" SET version=version+1',
      'DELETE FROM "FinanceGrant"',
      `SELECT encova_finance_setup_owner(NULL,'supabase','',CURRENT_TIMESTAMP,'','test reason',gen_random_uuid(),NULL)`,
    ]) {
      await sql.query("BEGIN");
      await sql.query("SET LOCAL ROLE encova_app");
      await expect(sql.query(query)).rejects.toMatchObject({ code: "42501" });
      await sql.query("ROLLBACK");
    }
    const legacy = await auth.api.getSession({
      headers: request("owner").headers,
    });
    await sql.query("BEGIN");
    await sql.query("SET LOCAL ROLE encova_app");
    const result = await sql.query(
      "SELECT encova_finance_access_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'GRANT',$3::jsonb,$4,$5) AS result",
      [
        people.owner.id,
        legacy!.session.id,
        JSON.stringify({
          targetId: people.target.id,
          expectedVersion: (await settings()).version,
          reason: "Runtime command acceptance",
        }),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ],
    );
    expect(result.rows[0].result.id).toBeTruthy();
    await sql.query("COMMIT");
  } finally {
    await sql.end();
  }
});
it("HTTP denies unselected administrators, requires CSRF/strict bodies and returns private errors", async () => {
  expect((await accessRead(request("other"))).status).toBe(403);
  const missingOrigin = new Request(request("owner"), {
    method: "POST",
    headers: { cookie: cookies.owner, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const forbidden = await accessMutation(missingOrigin, "GRANT", grantSchema);
  expect(forbidden.status).toBe(403);
  expect(forbidden.headers.get("cache-control")).toContain("no-store");
  const response = await accessMutation(
    request("owner", {
      targetId: people.target.id,
      expectedVersion: 1,
      reason: "Injected identity",
      actorId: people.owner.id,
      reauth: { password },
    }),
    "GRANT",
    grantSchema,
  );
  expect(response.status).toBe(422);
  const granted = await accessMutation(
    request("owner", {
      targetId: people.target.id,
      expectedVersion: (await settings()).version,
      reason: "Actual HTTP grant",
      reauth: { password },
    }),
    "GRANT",
    grantSchema,
  );
  expect(granted.status).toBe(201);
  expect(granted.headers.get("cache-control")).toContain("no-store");
});
it("operator command requires a private credential file and does not expose credentials", async () => {
  await cleanupOwnedFinance();
  await mkdir(".local/finance", { recursive: true });
  const path = resolve(
    `.local/finance/owner-fixture-${crypto.randomUUID()}.json`,
  );
  await writeFile(
    path,
    JSON.stringify({
      cookie: cookies.owner,
      password,
      reason: "CLI isolated bootstrap",
    }),
    { mode: 0o600 },
  );
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--conditions=react-server",
      "scripts/finance/setup-owner.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: url,
        DIRECT_URL: url,
        FINANCE_ENABLED: "true",
        FINANCE_OWNER_ID: people.owner.id,
        FINANCE_OWNER_USERNAME: people.owner.username,
        FINANCE_OPERATOR_ACK: "BOOTSTRAP_EXPLICIT_OWNER",
        FINANCE_CREDENTIAL_FILE: path,
      },
      timeout: 20000,
      encoding: "utf8",
    },
  );
  expect(output).toContain("initialized atomically");
  expect(output).not.toContain(password);
  expect(output).not.toContain(cookies.owner);
  await expect(access(path)).rejects.toThrow();
  expect((await settings()).ownerId).toBe(people.owner.id);
});
it("operator recovery requires a fresh new-owner proof, revokes former access and leaves an audit", async () => {
  const verified = await proof("target");
  await setupOwner(
    verified.actor,
    verified.proof,
    people.target.username,
    "Verified operator recovery",
    "Operator fixture / identity-check-ref-123",
  );
  const current = await settings();
  expect(current.ownerId).toBe(people.target.id);
  await expect(financeStatus(people.owner)).rejects.toMatchObject({
    status: 403,
  });
  expect(
    await db.session.count({ where: { userId: people.owner.authUserId! } }),
  ).toBe(0);
  expect(
    await db.financeAuditEvent.count({
      where: { actorId: people.target.id, action: "FINANCE_OWNER_RECOVERED" },
    }),
  ).toBeGreaterThan(0);
});
