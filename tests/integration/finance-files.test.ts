import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { createHmac } from "node:crypto";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
process.env.FINANCE_ENABLED = "true";
const { db } = await import("@/server/db"),
  { env } = await import("@/server/env");
const { verifyFinanceReauthentication } =
    await import("@/modules/finance/access/reauth"),
  { setupOwner } = await import("@/modules/finance/access/service");
const { setupCommand } = await import("@/modules/finance/accounting/service"),
  { masterCommand } = await import("@/modules/finance/masters/service");
const { billCommand } = await import("@/modules/finance/payables/service");
const {
  reserveFile,
  completeFile,
  scanFile,
  retryFileScan,
  removeFile,
  downloadFile,
  files,
  fileDetail,
  FILE_CHUNK_BYTES,
} = await import("@/modules/finance/documents/files/service");
const { fileRead, fileMutation } =
  await import("@/modules/finance/documents/files/http");
const { fileDigest } = await import("@/modules/attachments/storage");
const scanKey = "Synthetic-file-scan-secret-only-32-characters";
const scanKeyId = crypto.randomUUID();
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "F19." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0,
  client: string,
  ar: string,
  revenue: string,
  cash: string,
  period: { id: string; start: string; end: string };
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const req = (who = "owner", body?: unknown, key = crypto.randomUUID()) =>
  new Request(env.APP_URL + "/api/v1/finance/bills", {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookies[who] ?? "",
      origin: env.APP_URL,
      "x-encova-csrf": "1",
      "content-type": "application/json",
      "idempotency-key": key,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const proof = (who = "owner") =>
  verifyFinanceReauthentication(req(who), { password });
async function command(
  action: Parameters<typeof billCommand>[2],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return billCommand(v.actor, v.proof, action, body, key);
}
async function config(
  action: Parameters<typeof setupCommand>[2],
  body: unknown,
) {
  const v = await proof();
  return setupCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function master(
  action: Parameters<typeof masterCommand>[2],
  body: unknown,
) {
  const v = await proof();
  return masterCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function account(patch: Record<string, unknown> = {}) {
  return (
    await config("ACCOUNT_CREATE", {
      code: prefix + "." + ++count,
      name: prefix + " account " + count,
      type: "ASSET",
      normalSide: "DEBIT",
      reportGroup: "CURRENT_ASSETS",
      controlType: "NONE",
      currency: "PKR",
      parentId: null,
      isPosting: true,
      isContra: false,
      isCashEquivalent: false,
      reason: "Explicit synthetic bill mapping",
      ...patch,
    })
  ).id;
}
const partyBody = (patch: Record<string, unknown> = {}) => ({
  name: prefix + " client " + ++count,
  legalName: prefix + " Synthetic Legal Co",
  kind: "SUPPLIER",
  contactEmail: "synthetic@example.test",
  phone: null,
  address: "Synthetic bill address",
  userId: null,
  reason: "Explicit synthetic client",
  ...patch,
});
async function party(patch: Record<string, unknown> = {}) {
  return (await master("PARTY_CREATE", partyBody(patch))).id;
}
async function newPeriod(future = false) {
  const rows = await db.$queryRaw<
    { start: Date }[]
  >`SELECT d::date AS start FROM generate_series(${future ? "8100-01-01" : "1951-01-01"}::date,${future ? "8150-01-01" : "1999-01-01"}::date,interval '10 days') d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]') && daterange(d::date,(d+interval '9 days')::date,'[]')) ORDER BY d LIMIT 1`;
  if (!rows.length) throw new Error("No isolated bill test interval");
  const start = rows[0].start.toISOString().slice(0, 10),
    end = new Date(rows[0].start.getTime() + 9 * 86400000)
      .toISOString()
      .slice(0, 10);
  return {
    id: (
      await config("PERIOD_CREATE", {
        name: prefix + " synthetic only",
        startDate: start,
        endDate: end,
        reason: "Isolated bill test interval",
      })
    ).id,
    start,
    end,
  };
}
const line = (patch: Record<string, unknown> = {}) => ({
  description: "Synthetic earned service",
  quantity: "1",
  unitRate: "300000.00",
  discountAmount: "0.00",
  treatment: "EXPENSE",
  costAccountId: revenue,
  projectId: null,
  ...patch,
});
const body = (patch: Record<string, unknown> = {}) => ({
  kind: "BILL",
  referenceReliable: true,
  duplicateAcknowledged: true,
  cashAccountId: null,
  reference: prefix + "." + ++count,
  partyId: client,
  payableAccountId: ar,
  projectId: null,
  billDate: period.start,
  postingDate: period.start,
  dueDate: period.end,
  description: "Synthetic service bill",
  evidence: "Fixture evidence only",
  currency: "PKR",
  lines: [line()],
  reason: "Reviewed synthetic bill",
  ...patch,
});
async function release() {
  const ids = Object.values(people).map((p) => p.id),
    setting = await db.financeSettings.findFirst();
  if (setting && !ids.includes(setting.ownerId))
    throw new Error("Refuse unowned finance singleton cleanup");
  if (setting) await db.$executeRawUnsafe('TRUNCATE "FinanceSettings"');
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
      "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;",
    );
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
  } finally {
    await sql.end();
  }
  for (const [name, role] of [
    ["owner", "SUPER_ADMIN"],
    ["selected", "SUPER_ADMIN"],
    ["other", "SUPER_ADMIN"],
    ["hr", "HR_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
  ] as const) {
    const email = prefix.toLowerCase() + "." + name + "@example.test",
      signed = await auth.api.signUpEmail({ body: { name, email, password } });
    await db.user.update({
      where: { id: signed.user.id },
      data: { emailVerified: true },
    });
    people[name] = await db.person.create({
      data: {
        email,
        authUserId: signed.user.id,
        username: prefix.toLowerCase() + "." + name,
        displayName: name,
        role,
        status: "ACTIVE",
      },
    });
    const session = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    cookies[name] = session.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }
  await release();
  const v = await proof();
  await setupOwner(
    v.actor,
    v.proof,
    people.owner.username,
    "Explicit F11 synthetic owner",
  );
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "Explicit bill tester",
    },
  });
  ar = await account({
    controlType: "PAYABLES",
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
  });
  revenue = await account({
    type: "OPERATING_EXPENSE",
    normalSide: "DEBIT",
    reportGroup: "OPERATING_EXPENSES",
  });
  cash = await account({ controlType: "CASH" });
  client = await party();
  cash = (
    await master("CASH_CREATE", {
      name: prefix + " cash",
      kind: "BANK",
      glAccountId: cash,
      reason: "Synthetic bill cash master",
    })
  ).id;
  period = await newPeriod();
  await db.financeScanAuthority.create({
    data: {
      id: scanKeyId,
      name: "Synthetic isolated scanner only",
      secret: Buffer.from(scanKey),
      createdById: people.owner.id,
      reason: "Explicit test attestation authority",
    },
  });
}, 30000);
afterAll(async () => {
  await release();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});

const blobs = new Map<string, Uint8Array>();
let gets = 0,
  failRemove = false;
let beforeGet: (() => Promise<void>) | undefined;
const storage = {
  signedUpload: async (key: string) =>
    "https://synthetic-upload.example.test/" + key,
  put: async (key: string, bytes: Uint8Array) => {
    blobs.set(key, bytes);
  },
  get: async (key: string) => {
    gets++;
    if (beforeGet) {
      const hook = beforeGet;
      beforeGet = undefined;
      await hook();
    }
    const b = blobs.get(key);
    if (!b) throw new Error("Synthetic storage missing");
    return b;
  },
  remove: async (key: string) => {
    if (failRemove) throw new Error("Synthetic storage outage");
    blobs.delete(key);
  },
};
const bytes = () =>
  new TextEncoder().encode("%PDF-1.7\nSynthetic finance evidence\n%%EOF");
async function source(posted = false) {
  const d = await command("CREATE", body());
  if (posted)
    await command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Posted evidence source",
    });
  return d.id;
}
async function reserve(
  sourceId: string,
  who = "owner",
  key = crypto.randomUUID(),
  data = bytes(),
) {
  const v = await proof(who);
  return reserveFile(
    v.actor,
    v.proof,
    {
      sourceType: "BILL",
      sourceId,
      fileName: "Synthetic evidence.pdf",
      mimeType: "application/pdf",
      byteSize: data.length,
      sha256: fileDigest(data),
      reason: "Explicit evidence upload",
    },
    key,
    storage,
  );
}
async function uploaded(sourceId: string, who = "owner", data = bytes()) {
  const r = await reserve(sourceId, who, undefined, data);
  const row = await db.financeFile.findUniqueOrThrow({
    where: { id: r.file.id },
  });
  await storage.put(row.objectKey, data);
  await completeFile(people[who], { id: r.file.id, intent: r.intent }, storage);
  return r;
}
const scanner = async (
  _bytes: Uint8Array,
  sha256: string,
  _mime: string,
  fileId: string,
  challenge: string,
  status: "CLEAN" | "INFECTED" = "CLEAN",
) => {
  const engine = "Synthetic scanner fixture 1.0",
    message = [
      fileId,
      sha256,
      String(_bytes.length),
      status,
      String(Buffer.byteLength(engine)),
      engine,
      challenge,
    ].join(":");
  return {
    status,
    sha256,
    engine,
    keyId: scanKeyId,
    signature: createHmac("sha256", scanKey).update(message).digest("hex"),
  };
};
async function clean(sourceId: string, who = "owner", data = bytes()) {
  const r = await uploaded(sourceId, who, data);
  await scanFile(
    people[who],
    { id: r.file.id, intent: r.intent },
    storage,
    scanner,
  );
  return r;
}
it("denies lower roles and unselected root before metadata, upload or malformed source disclosure", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(files(people[who], { invalid: true })).rejects.toMatchObject({
      code: "FINANCE_FORBIDDEN",
    });
    expect((await fileRead(req(who))).status).toBe(403);
    expect(
      (await fileMutation(req(who, { invalid: true }), "RESERVE")).status,
    ).toBe(403);
  }
});
it("reserves randomized evidence, quarantines actual bytes and downloads only after verified scan", async () => {
  const id = await source(),
    r = await uploaded(id);
  expect(r.file.state).toBe("RESERVED");
  expect(await fileDetail(people.owner, r.file.id)).not.toHaveProperty(
    "objectKey",
  );
  await expect(
    downloadFile(people.owner, r.file.id, null, storage),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_UNAVAILABLE" });
  const result = await scanFile(
    people.owner,
    { id: r.file.id, intent: r.intent },
    storage,
    scanner,
  );
  expect(result.file.state).toBe("CLEAN");
  expect(
    (await downloadFile(people.owner, r.file.id, null, storage)).bytes,
  ).toEqual(bytes());
});
it("scanner outage and forged result never release quarantine", async () => {
  const r = await uploaded(await source());
  expect(
    (
      await scanFile(
        people.owner,
        { id: r.file.id, intent: r.intent },
        storage,
        async () => null,
      )
    ).scanPending,
  ).toBe(true);
  await expect(
    scanFile(
      people.owner,
      { id: r.file.id, intent: r.intent },
      storage,
      async (b, h, m, id, c) => ({
        ...(await scanner(b, h, m, id, c)),
        signature: "0".repeat(64),
      }),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_SIGNATURE" });
  expect((await fileDetail(people.owner, r.file.id)).state).toBe("QUARANTINED");
});
it("infected evidence remains unavailable and a result cannot be replayed onto another file", async () => {
  const first = await uploaded(await source()),
    second = await uploaded(await source());
  expect(
    (
      await scanFile(
        people.owner,
        { id: first.file.id, intent: first.intent },
        storage,
        (b, h, m, id, c) => scanner(b, h, m, id, c, "INFECTED"),
      )
    ).file.state,
  ).toBe("REJECTED");
  await expect(
    downloadFile(people.owner, first.file.id, null, storage),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_UNAVAILABLE" });
  await expect(
    scanFile(
      people.owner,
      { id: second.file.id, intent: second.intent },
      storage,
      (b, h, m, _id, c) => scanner(b, h, m, first.file.id, c),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_SIGNATURE" });
});
it("wrong or expired intent fails before storage read; reauthentication by selected admin resumes without changing original uploader", async () => {
  const r = await uploaded(await source()),
    prior = gets;
  await expect(
    completeFile(
      people.owner,
      { id: r.file.id, intent: "0".repeat(64) },
      storage,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_INTENT" });
  expect(gets).toBe(prior);
  const v = await proof("selected");
  const resumed = await retryFileScan(
    v.actor,
    v.proof,
    { id: r.file.id, reason: "Resume quarantined evidence" },
    crypto.randomUUID(),
    storage,
    scanner,
  );
  expect(resumed.file.state).toBe("CLEAN");
  expect(resumed.file.uploader.displayName).toBe("owner");
  await expect(
    scanFile(
      people.owner,
      { id: r.file.id, intent: r.intent },
      storage,
      scanner,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_INTENT" });
});
it("completion rejects changed bytes, wrong size and mismatched type without committing state", async () => {
  const r = await reserve(await source()),
    row = await db.financeFile.findUniqueOrThrow({ where: { id: r.file.id } });
  await storage.put(row.objectKey, new TextEncoder().encode("not matching"));
  await expect(
    completeFile(people.owner, { id: r.file.id, intent: r.intent }, storage),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_INTEGRITY" });
  expect((await fileDetail(people.owner, r.file.id)).state).toBe("RESERVED");
});
it("per-document quota is atomic under competing reservations and source FK stays private", async () => {
  const id = await source(),
    out = await Promise.allSettled(
      Array.from({ length: 12 }, () => reserve(id)),
    );
  expect(out.filter((x) => x.status === "fulfilled")).toHaveLength(10);
  expect(
    (await files(people.owner, { sourceType: "BILL", sourceId: id })).total,
  ).toBe(10);
});
it("replayed reservation keeps one file and rotates only its purpose-bound intent", async () => {
  const id = await source(),
    key = crypto.randomUUID(),
    a = await reserve(id, "owner", key),
    b = await reserve(id, "owner", key);
  expect(a.file.id).toBe(b.file.id);
  expect(a.intent).not.toBe(b.intent);
  expect(
    (await files(people.owner, { sourceType: "BILL", sourceId: id })).total,
  ).toBe(1);
  await expect(
    completeFile(people.owner, { id: a.file.id, intent: a.intent }, storage),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_INTENT" });
});
it("posted evidence cannot be removed through command or raw state tampering", async () => {
  const id = await source(),
    r = await clean(id);
  await command("POST", {
    id,
    expectedVersion: 1,
    reason: "Post source retaining evidence",
  });
  const v = await proof();
  await expect(
    removeFile(
      v.actor,
      v.proof,
      { id: r.file.id, reason: "Posted removal blocked" },
      crypto.randomUUID(),
      storage,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_RETAINED" });
  await expect(
    db.$executeRaw`UPDATE "FinanceFile" SET state='REMOVED',version=version+1 WHERE id=${r.file.id}::uuid`,
  ).rejects.toThrow("FINANCE_FILE_RETAINED");
});
it("draft removal retains metadata and failed blob deletion is recoverable with the original key", async () => {
  const r = await clean(await source()),
    key = crypto.randomUUID();
  failRemove = true;
  let v = await proof();
  const pending = await removeFile(
    v.actor,
    v.proof,
    { id: r.file.id, reason: "Remove draft evidence" },
    key,
    storage,
  );
  expect(pending.cleanupPending).toBe(true);
  expect(pending.file.state).toBe("REMOVED");
  failRemove = false;
  v = await proof();
  const retried = await removeFile(
    v.actor,
    v.proof,
    { id: r.file.id, reason: "Remove draft evidence" },
    key,
    storage,
  );
  expect(retried.cleanupPending).toBe(false);
  expect(retried.file.blobDeletedAt).not.toBeNull();
});
it("large evidence downloads use bounded currently-authorized ranges and detect storage replacement", async () => {
  const data = new Uint8Array(7 * 1024 * 1024);
  data.set(bytes());
  const r = await clean(await source(), "owner", data);
  await expect(
    downloadFile(people.owner, r.file.id, null, storage),
  ).rejects.toMatchObject({ code: "FILE_RANGE" });
  const first = await downloadFile(
    people.owner,
    r.file.id,
    `bytes=0-${FILE_CHUNK_BYTES - 1}`,
    storage,
  );
  expect(first.bytes.length).toBe(FILE_CHUNK_BYTES);
  expect(first.partial).toBe(true);
  const row = await db.financeFile.findUniqueOrThrow({
    where: { id: r.file.id },
  });
  blobs.set(row.objectKey, bytes());
  await expect(
    downloadFile(people.owner, r.file.id, "bytes=0-9", storage),
  ).rejects.toMatchObject({ code: "FINANCE_FILE_INTEGRITY" });
});
it("revocation during object retrieval prevents response bytes from leaving the authenticated proxy", async () => {
  const r = await clean(await source());
  beforeGet = async () => {
    await db.financeGrant.updateMany({
      where: { userId: people.selected.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: people.owner.id },
    });
  };
  await expect(
    downloadFile(people.selected, r.file.id, null, storage),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "Restore isolated test selection",
    },
  });
});
it("raw SQL cannot forge CLEAN and runtime cannot read scanner secrets, write files or call signing helpers", async () => {
  const r = await uploaded(await source());
  await expect(
    db.$executeRaw`UPDATE "FinanceFile" SET state='CLEAN',"scanResult"=${JSON.stringify({ status: "CLEAN", sha256: r.file.sha256, engine: "Forged", keyId: scanKeyId, signature: "0".repeat(64) })}::jsonb,version=version+1 WHERE id=${r.file.id}::uuid`,
  ).rejects.toThrow("FINANCE_FILE_SIGNATURE");
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    const message = "Synthetic HMAC vector: و",
      vector = await sql.query(
        "SELECT encova_finance_file_hmac($1::bytea,$2) AS signature",
        [Buffer.from(scanKey), message],
      );
    expect(vector.rows[0].signature).toBe(
      createHmac("sha256", scanKey).update(message).digest("hex"),
    );
    await sql.query("SET ROLE encova_app");
    const access = await sql.query(
      `SELECT has_table_privilege(current_user,'"FinanceFile"','INSERT') AS write,has_table_privilege(current_user,'"FinanceScanAuthority"','SELECT') AS secret,has_function_privilege(current_user,'encova_finance_file_hmac(bytea,text)','EXECUTE') AS helper,has_function_privilege(current_user,'encova_finance_file_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command`,
    );
    expect(access.rows[0]).toEqual({
      write: false,
      secret: false,
      helper: false,
      command: true,
    });
  } finally {
    await sql.end();
  }
});

it("scanner setup CLI consumes private credentials, enforces Finance Owner and never logs its signing key", async () => {
  await mkdir(".local/finance", { recursive: true });
  const id = crypto.randomUUID(),
    hex = "2a".repeat(32),
    run = async (who: string) => {
      const file = resolve(
        ".local/finance/scanner-test-" + crypto.randomUUID() + ".json",
      );
      await writeFile(
        file,
        JSON.stringify({
          cookie: cookies[who],
          password,
          reason: "Isolated scanner CLI test",
          keyId: id,
          name: "Synthetic CLI scanner",
          signingSecretHex: hex,
        }),
        { mode: 0o600 },
      );
      let output = "",
        status = 0;
      try {
        output = execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "--conditions=react-server",
            "scripts/finance/configure-scanner.ts",
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              DATABASE_URL: url,
              DIRECT_URL: url,
              FINANCE_ENABLED: "true",
              AUTH_PROVIDER: "better-auth",
              APP_URL: env.APP_URL,
              BETTER_AUTH_URL: env.APP_URL,
              FINANCE_CREDENTIAL_FILE: file,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (e) {
        const failure = e as {
          status: number;
          stdout?: string;
          stderr?: string;
        };
        status = failure.status;
        output = String(failure.stdout ?? "") + String(failure.stderr ?? "");
      }
      await expect(access(file)).rejects.toThrow();
      expect(output).not.toContain(password);
      expect(output).not.toContain(hex);
      return { status, output };
    };
  expect((await run("selected")).status).toBe(1);
  expect((await run("owner")).status).toBe(0);
  expect(
    await db.financeScanAuthority.findUnique({ where: { id } }),
  ).not.toBeNull();
  expect(
    JSON.stringify(
      (
        await db.financeAuditEvent.findFirstOrThrow({
          where: { entityType: "FinanceScanAuthority", entityId: id },
        })
      ).data,
    ),
  ).not.toContain(hex);
});
