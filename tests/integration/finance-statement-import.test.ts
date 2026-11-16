import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { readFile } from "node:fs/promises";
import pg from "pg";
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
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "SI30." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0;
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const req = (who = "owner", body?: unknown, key = crypto.randomUUID()) =>
  new Request(env.APP_URL + "/api/v1/finance/projects", {
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
}, 30000);
afterAll(async () => {
  await release();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});

const { createHash } = await import("node:crypto");
const {
  reserveStatement,
  uploadStatementChunk,
  statementUpload,
  statementGrid,
  previewStatement,
  importStatement,
  statementAction,
  statementBatch,
  statementBatches,
  statementBankOptions,
} = await import("@/modules/finance/treasury/statements/service");
const { STATEMENT_CHUNK_BYTES } =
  await import("@/modules/finance/treasury/statements/csv");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const mapping = {
  mode: "SIGNED",
  skipRows: 0,
  dateColumn: 0,
  dateFormat: "ISO",
  amountColumn: 1,
  positiveMeans: "RECEIPT",
  descriptionColumn: 2,
  referenceColumn: 3,
};
const metadata = (patch: Record<string, unknown> = {}) => ({
  mapping,
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  openingBalance: "0.00",
  closingBalance: "10.01",
  currency: "PKR",
  ...patch,
});
const csv = (
  amount = "10.01",
  description = "Reviewed bank deposit",
  reference = "REF1",
  ending = "\n",
) =>
  Buffer.from(
    [
      "Date,Amount,Description,Reference",
      "2026-11-01," + amount + "," + description + "," + reference,
      "",
    ].join(ending),
  );
async function bank() {
  const gl = await account({ controlType: "CASH" });
  return (
    await master("CASH_CREATE", {
      name: prefix + " bank " + ++count,
      kind: "BANK",
      glAccountId: gl,
      maskedReference: "1234",
      reason: "Explicit synthetic statement bank",
    })
  ).id;
}
async function reserve(
  bankId: string,
  bytes: Buffer,
  who = "owner",
  requestKey = crypto.randomUUID(),
  patch: Record<string, unknown> = {},
) {
  const v = await proof(who);
  return reserveStatement(
    v.actor,
    v.proof,
    {
      cashAccountId: bankId,
      fileName: "synthetic-bank.csv",
      byteSize: bytes.length,
      sha256: hash(bytes),
      reason: "Review CSV evidence without posting money",
      ...patch,
    },
    requestKey,
  );
}
async function send(
  r: Awaited<ReturnType<typeof reserve>>,
  bytes: Buffer,
  who = "owner",
) {
  if (!r.upload || !r.intent) throw Error("Expected pending scoped upload");
  for (
    let index = 0;
    index < Math.ceil(bytes.length / STATEMENT_CHUNK_BYTES);
    index++
  ) {
    const part = bytes.subarray(
      index * STATEMENT_CHUNK_BYTES,
      (index + 1) * STATEMENT_CHUNK_BYTES,
    );
    await uploadStatementChunk(people[who], r.upload.id, {
      index,
      content: part.toString("base64"),
      sha256: hash(part),
      intent: r.intent,
    });
  }
  return r.upload.id;
}
async function uploaded(
  bankId: string,
  bytes = csv(),
  who = "owner",
  patch: Record<string, unknown> = {},
) {
  const r = await reserve(bankId, bytes, who, crypto.randomUUID(), patch);
  await send(r, bytes, who);
  return r.upload!.id;
}
async function commit(
  id: string,
  meta: ReturnType<typeof metadata> = metadata(),
  patch: Record<string, unknown> = {},
  who = "owner",
  requestKey = crypto.randomUUID(),
) {
  const p = await previewStatement(people[who], id, meta),
    v = await proof(who);
  return importStatement(
    v.actor,
    v.proof,
    id,
    {
      ...meta,
      expectedVersion: p.uploadVersion,
      basisHash: p.basisHash,
      acknowledgedRows: [],
      duplicateReview: "",
      reason: "Import reviewed statement evidence explicitly",
      ...patch,
    },
    requestKey,
  );
}
it("bounded transport and explicit preview/import retain file, account, dates, exact totals and source fingerprints without GL", async () => {
  const b = await bank(),
    bytes = csv(),
    before = await db.financeJournalEntry.count(),
    id = await uploaded(b, bytes),
    grid = await statementGrid(people.owner, id),
    p = await previewStatement(people.owner, id, metadata());
  expect(grid.headers).toHaveLength(4);
  expect(p).toMatchObject({
    rowCount: 1,
    receipts: "10.01",
    payments: "0.00",
    difference: "0.00",
    balanced: true,
    duplicateCount: 0,
  });
  const result = await commit(id),
    d = await statementBatch(people.owner, result.id!);
  expect(d.item).toMatchObject({
    cashAccountId: b,
    sha256: hash(bytes),
    rowCount: 1,
    openingBalance: "0.00",
    closingBalance: "10.01",
    receipts: "10.01",
    payments: "0.00",
    parserVersion: "ENCOVA_CSV_V1",
    state: "IMPORTED",
  });
  expect(d.lines[0]).toMatchObject({
    sourceRow: 2,
    valueDate: "2026-11-01",
    amount: "10.01",
    direction: "RECEIPT",
  });
  expect(d.lines[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect(d.item).not.toHaveProperty("duplicateSnapshot");
  expect(d.item).not.toHaveProperty("sourceSnapshot");
});
it("exact reimports return the original batch across selected actors without duplicating rows", async () => {
  const b = await bank(),
    bytes = csv(),
    id = await uploaded(b, bytes),
    one = await commit(id),
    again = await reserve(b, bytes, "selected");
  expect(again).toMatchObject({
    upload: null,
    intent: null,
    reused: true,
    batch: { id: one.id },
  });
  expect(
    await db.financeStatementBatch.count({ where: { cashAccountId: b } }),
  ).toBe(1);
  expect(
    await db.financeStatementLine.count({ where: { batchId: one.id } }),
  ).toBe(1);
});
it("concurrent exact imports from independent uploaders serialize to one retained source", async () => {
  const b = await bank(),
    bytes = csv(),
    one = await uploaded(b, bytes),
    two = await uploaded(b, bytes, "selected"),
    r = await Promise.all([
      commit(one),
      commit(two, metadata(), {}, "selected"),
    ]);
  expect(r[0].id).toBe(r[1].id);
  expect(r.map((v) => v.reused).sort()).toEqual([false, true]);
  expect(
    await db.financeStatementBatch.count({ where: { cashAccountId: b } }),
  ).toBe(1);
  expect((await statementUpload(people.selected, two)).resultBatchId).toBe(
    r[0].id,
  );
});
it("cross-file possible duplicates require explicit acknowledgement and remain separate retained rows", async () => {
  const b = await bank(),
    first = await uploaded(b, csv());
  await commit(first);
  const second = await uploaded(
      b,
      csv("10.01", "Reviewed bank deposit", "REF1", "\r\n"),
    ),
    p = await previewStatement(people.owner, second, metadata());
  expect(p.duplicateCount).toBe(1);
  expect(p.duplicateEvidence[0]).toMatchObject({
    sourceRow: 2,
    existingCount: 1,
    withinSourceCount: 1,
  });
  expect(p.duplicateEvidence[0].sampleLines).toHaveLength(1);
  await expect(commit(second)).rejects.toMatchObject({
    code: "FINANCE_STATEMENT_DUPLICATES",
  });
  const corrected = await commit(second, metadata(), {
    acknowledgedRows: [2],
    duplicateReview:
      "Reviewed overlapping export; retain this evidenced record",
  });
  expect(
    (await statementBatch(people.owner, corrected.id!)).item.duplicateCount,
  ).toBe(1);
  expect(
    await db.financeStatementLine.count({
      where: { batch: { cashAccountId: b } },
    }),
  ).toBe(2);
});
it("identical legitimate rows inside one file are flagged for review rather than silently removed", async () => {
  const b = await bank(),
    bytes = Buffer.from(
      "Date,Amount,Description,Reference\n2026-11-01,10.01,Deposit,SAME\n2026-11-01,10.01,Deposit,SAME\n",
    ),
    id = await uploaded(b, bytes),
    meta = metadata({ closingBalance: "20.02" }),
    p = await previewStatement(people.owner, id, meta);
  expect(p.duplicateRows).toEqual([2, 3]);
  expect(p.duplicateEvidence[0].withinSourceCount).toBe(2);
  const r = await commit(id, meta, {
    acknowledgedRows: [2, 3],
    duplicateReview: "Two separately confirmed identical bank transactions",
  });
  expect((await statementBatch(people.owner, r.id!)).lines).toHaveLength(2);
});
it("new duplicate evidence invalidates an earlier preview before confirmation", async () => {
  const b = await bank(),
    one = await uploaded(b, csv()),
    two = await uploaded(
      b,
      csv("10.01", "Reviewed bank deposit", "REF1", "\r\n"),
    ),
    p = await previewStatement(people.owner, two, metadata());
  await commit(one);
  const v = await proof();
  await expect(
    importStatement(
      v.actor,
      v.proof,
      two,
      {
        ...metadata(),
        expectedVersion: p.uploadVersion,
        basisHash: p.basisHash,
        acknowledgedRows: [],
        duplicateReview: "",
        reason: "Cannot confirm stale duplicate evidence",
      },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_STATEMENT_STALE_PREVIEW" });
  expect(
    (await previewStatement(people.owner, two, metadata())).duplicateCount,
  ).toBe(1);
});
it("opening/closing equation and bank date placement are independently validated before import", async () => {
  const b = await bank(),
    id = await uploaded(b, csv()),
    p = await previewStatement(
      people.owner,
      id,
      metadata({ closingBalance: "10.00" }),
    );
  expect(p).toMatchObject({ balanced: false, difference: "-0.01" });
  await expect(
    commit(id, metadata({ closingBalance: "10.00" })),
  ).rejects.toMatchObject({ code: "FINANCE_STATEMENT_EQUATION" });
  await expect(
    previewStatement(people.owner, id, metadata({ startDate: "2026-11-02" })),
  ).rejects.toMatchObject({ code: "FINANCE_STATEMENT_RANGE" });
  expect(
    await db.financeStatementBatch.count({ where: { cashAccountId: b } }),
  ).toBe(0);
});
it("a racing alternative mapping cannot overwrite the already imported original evidence", async () => {
  const b = await bank(),
    one = await uploaded(b, csv()),
    two = await uploaded(b, csv(), "selected");
  await commit(one);
  await expect(
    commit(
      two,
      metadata({
        mapping: { ...mapping, positiveMeans: "PAYMENT" },
        openingBalance: "10.01",
        closingBalance: "0.00",
      }),
      {},
      "selected",
    ),
  ).rejects.toMatchObject({ code: "FINANCE_STATEMENT_REIMPORT_CONFLICT" });
  expect(
    await db.financeStatementBatch.count({ where: { cashAccountId: b } }),
  ).toBe(1);
});
it("reserve replay rotates a scoped transport capability without storing plaintext in receipts or audits", async () => {
  const b = await bank(),
    bytes = csv(),
    key = crypto.randomUUID(),
    one = await reserve(b, bytes, "owner", key),
    two = await reserve(b, bytes, "owner", key);
  expect(two.upload?.id).toBe(one.upload?.id);
  expect(two.intent).not.toBe(one.intent);
  await expect(send(one, bytes)).rejects.toMatchObject({
    code: "FINANCE_STATEMENT_UPLOAD_EXPIRED",
  });
  await send(two, bytes);
  const receipt = await db.financeLedgerReceipt.findFirstOrThrow({
      where: { actorId: people.owner.id, operation: "STMT_RESERVE", key },
    }),
    events = await db.financeAuditEvent.findMany({
      where: { entityId: one.upload!.id },
    });
  for (const secret of [one.intent!, two.intent!]) {
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(secret);
  }
  expect(
    await statementUpload(people.owner, one.upload!.id),
  ).not.toHaveProperty("intentHash");
});
it("transport is immutable, scoped to its uploader and expires independently of source read access", async () => {
  const b = await bank(),
    bytes = csv(),
    r = await reserve(b, bytes);
  await expect(send(r, bytes, "selected")).rejects.toMatchObject({
    code: "FINANCE_STATEMENT_UPLOAD_EXPIRED",
  });
  await db.financeStatementUpload.update({
    where: { id: r.upload!.id },
    data: { intentVerifiedAt: new Date(Date.now() - 600000), version: 2 },
  });
  await expect(send(r, bytes)).rejects.toMatchObject({
    code: "FINANCE_STATEMENT_UPLOAD_EXPIRED",
  });
  const renewed = await reserve(b, bytes);
  await send(renewed, bytes);
  const version = (await statementUpload(people.owner, r.upload!.id)).version;
  await send(renewed, bytes);
  expect((await statementUpload(people.owner, r.upload!.id)).version).toBe(
    version,
  );
  await expect(
    statementGrid(people.selected, r.upload!.id),
  ).rejects.toMatchObject({ status: 403 });
});
it("missing chunks and a declared file-hash mismatch cannot become statement sources", async () => {
  const b = await bank(),
    large = Buffer.alloc(STATEMENT_CHUNK_BYTES + 100, 97),
    r = await reserve(b, large),
    last = large.subarray(STATEMENT_CHUNK_BYTES);
  await uploadStatementChunk(people.owner, r.upload!.id, {
    index: 1,
    content: last.toString("base64"),
    sha256: hash(last),
    intent: r.intent,
  });
  await expect(statementGrid(people.owner, r.upload!.id)).rejects.toMatchObject(
    { code: "FINANCE_STATEMENT_FILE" },
  );
  const bytes = csv(),
    wrong = await reserve(b, bytes, "owner", crypto.randomUUID(), {
      sha256: "0".repeat(64),
    });
  await send(wrong, bytes);
  await expect(
    statementGrid(people.owner, wrong.upload!.id),
  ).rejects.toMatchObject({ code: "FINANCE_STATEMENT_FILE" });
});
it("void and explicit replacement retain both original file/rows and reviewed correction lineage", async () => {
  const b = await bank(),
    bytes = csv(),
    id = await uploaded(b, bytes),
    one = await commit(id),
    v = await proof();
  await statementAction(
    v.actor,
    v.proof,
    "VOID",
    one.id!,
    {
      expectedVersion: 2,
      reason: "Retain incorrect source before reviewed replacement",
    },
    crypto.randomUUID(),
  );
  const retained = await reserve(b, bytes);
  expect(retained).toMatchObject({
    upload: null,
    retainedVoided: true,
    batch: { id: one.id, state: "VOIDED" },
  });
  const correction = await uploaded(b, bytes, "owner", { replacesId: one.id }),
    two = await commit(correction);
  expect(two.id).not.toBe(one.id);
  expect((await statementBatch(people.owner, two.id!)).item.replacesId).toBe(
    one.id,
  );
  expect(
    (await statementBatch(people.owner, one.id!)).item.replacedBy?.id,
  ).toBe(two.id);
  expect(
    await db.financeStatementLine.count({
      where: { batch: { cashAccountId: b } },
    }),
  ).toBe(2);
  await expect(
    db.financeStatementLine.deleteMany({ where: { batchId: one.id } }),
  ).rejects.toThrow(/FINANCE_STATEMENT_IMMUTABLE/);
});
it("ordinary roles and unselected administrators cannot read source content, options, balances or stages", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(statementUpload(people[who], "bad-id")).rejects.toMatchObject({
      status: 403,
    });
    await expect(statementBatches(people[who], {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(statementBankOptions(people[who], {})).rejects.toMatchObject({
      status: 403,
    });
  }
  const b = await bank();
  expect(
    (await statementBankOptions(people.selected, { q: prefix })).items.some(
      (i) => i.id === b,
    ),
  ).toBe(true);
});
it("runtime has only actor/capability-checked interfaces, with no direct writes, internal helpers or Data API exposure", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"]) {
      await sql.query("SET ROLE " + role);
      const r = (
        await sql.query(
          `SELECT has_table_privilege(current_user,'"FinanceStatementChunk"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_statement_evaluate(uuid,jsonb,jsonb)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_statement_number','USAGE') AS number,has_function_privilege(current_user,'encova_finance_statement_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_statement_transport(uuid,jsonb)','EXECUTE') AS transport`,
        )
      ).rows[0];
      expect(r).toEqual({
        write: false,
        helper: false,
        number: false,
        command: role === "encova_app",
        transport: role === "encova_app",
      });
      await sql.query("RESET ROLE");
    }
  } finally {
    await sql.end();
  }
});
it("a CSV over Vercel's single-request limit imports 5,000 rows through bounded private transport without truncation", async () => {
  const { statementTransport } =
      await import("@/modules/finance/treasury/statements/http"),
    b = await bank(),
    text =
      "Date,Amount,Description,Reference\n" +
      Array.from(
        { length: 5000 },
        (_, i) =>
          "2026-11-01,0.01," +
          "x".repeat(930) +
          ",REF" +
          String(i + 1).padStart(5, "0"),
      ).join("\n") +
      "\n",
    bytes = Buffer.from(text);
  expect(bytes.length).toBeGreaterThan(4_500_000);
  expect(bytes.length).toBeLessThanOrEqual(5_000_000);
  const r = await reserve(b, bytes);
  for (
    let index = 0;
    index < Math.ceil(bytes.length / STATEMENT_CHUNK_BYTES);
    index++
  ) {
    const part = bytes.subarray(
        index * STATEMENT_CHUNK_BYTES,
        (index + 1) * STATEMENT_CHUNK_BYTES,
      ),
      input = {
        index,
        content: part.toString("base64"),
        sha256: hash(part),
        intent: r.intent,
      };
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(3_000_000);
    const response = await statementTransport(
      req("owner", input),
      r.upload!.id,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  const id = r.upload!.id,
    p = await previewStatement(
      people.owner,
      id,
      metadata({ closingBalance: "50.00" }),
      { page: 200 },
    );
  expect(p).toMatchObject({
    rowCount: 5000,
    receipts: "50.00",
    page: 200,
    pages: 200,
    duplicateCount: 0,
  });
  expect(p.rows).toHaveLength(25);
  expect(p.rows[24].sequence).toBe(5000);
  expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(250_000);
  const result = await commit(id, metadata({ closingBalance: "50.00" })),
    last = await statementBatch(people.owner, result.id!, { page: 200 });
  expect(last.item.rowCount).toBe(5000);
  expect(last.lines[24].sequence).toBe(5000);
  expect(
    await db.financeStatementLine.count({ where: { batchId: result.id } }),
  ).toBe(5000);
}, 30000);
it("statement HTTP validates current access, Origin, private responses and immutable server-derived rows", async () => {
  const {
      statementRead,
      statementTransport,
      statementPreview,
      statementMutation,
    } = await import("@/modules/finance/treasury/statements/http"),
    b = await bank(),
    bytes = csv(),
    id = await uploaded(b, bytes);
  for (const who of ["other", "hr", "lead", "member"]) {
    const response = await statementRead(req(who), "UPLOAD", id);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await statementTransport(req(who, {}), id)).status).toBe(403);
  }
  const malicious = req("owner", {
    ...metadata(),
    rows: [{ amount: "999999.00" }],
  });
  expect((await statementPreview(malicious, id)).status).toBe(422);
  const invalidOrigin = req("owner", metadata());
  invalidOrigin.headers.set("origin", "https://attacker.example.test");
  expect((await statementPreview(invalidOrigin, id)).status).toBe(403);
  const preview = await statementPreview(req("owner", metadata()), id);
  expect(preview.status).toBe(200);
  expect(preview.headers.get("cache-control")).toContain("no-store");
  const oversized = req("owner", { content: "x".repeat(3_000_001) });
  expect((await statementTransport(oversized, id)).status).toBe(413);
  const { jsonBody } = await import("@/server/http");
  await expect(
    jsonBody(req("owner", { content: "x".repeat(300_000) })),
  ).rejects.toMatchObject({ status: 413 });
  env.FINANCE_ENABLED = false;
  try {
    expect((await statementRead(req(), "BATCH")).status).toBe(404);
    expect((await statementMutation(req("owner", {}), "RESERVE")).status).toBe(
      404,
    );
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("source bank mapping is frozen and posted statement rows/snapshots cannot be forged or edited", async () => {
  const b = await bank(),
    id = await uploaded(b, csv()),
    r = await commit(id),
    d = await statementBatch(people.owner, r.id!),
    line = d.lines[0];
  await expect(
    db.financeStatementLine.update({
      where: { id: line.id },
      data: { amount: "1.00" },
    }),
  ).rejects.toThrow(/FINANCE_STATEMENT_IMMUTABLE/);
  await expect(
    db.financeStatementBatch.update({
      where: { id: r.id },
      data: { sourceSnapshot: { forged: true }, version: 3 },
    }),
  ).rejects.toThrow(/FINANCE_STATEMENT_IMMUTABLE/);
  await expect(
    db.financeStatementUpload.update({
      where: { id },
      data: { sha256: "0".repeat(64), version: 4 },
    }),
  ).rejects.toThrow(/FINANCE_STATEMENT_IMMUTABLE/);
  expect(d.item.glAccountId).toBe(
    (await db.financeCashAccount.findUniqueOrThrow({ where: { id: b } }))
      .glAccountId,
  );
});
it("a lost initialization response can be retried after import and returns the completed retained batch", async () => {
  const b = await bank(),
    bytes = csv(),
    key = crypto.randomUUID(),
    r = await reserve(b, bytes, "owner", key);
  await send(r, bytes);
  const imported = await commit(r.upload!.id),
    replayed = await reserve(b, bytes, "owner", key);
  expect(replayed).toMatchObject({
    upload: null,
    intent: null,
    reused: true,
    batch: { id: imported.id, state: "IMPORTED" },
  });
});
