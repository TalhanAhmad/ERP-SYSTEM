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
  prefix = "RC32." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

const { createHash } = await import("node:crypto");
const {
  reserveStatement,
  uploadStatementChunk,
  previewStatement,
  importStatement,
  statementBatch,
  statementAction,
} = await import("@/modules/finance/treasury/statements/service");
const { bankMatchCommand, bankMatchPreview } =
  await import("@/modules/finance/treasury/matching/service");
const { movementCommand } = await import("@/modules/finance/treasury/service");
async function move(
  action: Parameters<typeof movementCommand>[2],
  input: unknown,
) {
  const v = await proof();
  return movementCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function command(
  action: Parameters<typeof bankMatchCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return bankMatchCommand(v.actor, v.proof, action, input, key);
}
async function bank() {
  return (
    await master("CASH_CREATE", {
      name: prefix + " bank " + ++count,
      kind: "BANK",
      glAccountId: await account({ controlType: "CASH" }),
      maskedReference: "1234",
      reason: "Explicit synthetic bank for matching",
    })
  ).id;
}
async function fixture(
  amounts = ["10.01"],
  cashAmounts = amounts,
  laterPeriod = false,
  payment = false,
) {
  const p = await newPeriod(),
    bankPeriod = laterPeriod ? await newPeriod() : p,
    b = await bank(),
    from = await bank();
  const statementDate = bankPeriod.end,
    bytes = Buffer.from(
      "Date,Amount,Description\n" +
        amounts
          .map((x, i) => statementDate + "," + x + ",Reviewed record " + i)
          .join("\n") +
        "\n",
    ),
    sha = createHash("sha256").update(bytes).digest("hex");
  let v = await proof();
  const u = await reserveStatement(
    v.actor,
    v.proof,
    {
      cashAccountId: b,
      fileName: "matching.csv",
      byteSize: bytes.length,
      sha256: sha,
      reason: "Review synthetic imported evidence",
    },
    crypto.randomUUID(),
  );
  await uploadStatementChunk(people.owner, u.upload!.id, {
    index: 0,
    content: bytes.toString("base64"),
    sha256: sha,
    intent: u.intent,
  });
  const sum = amounts.reduce((s, a) => s + BigInt(a.replace(".", "")), 0n),
    total =
      (sum < 0n ? "-" : "") +
      (sum < 0n ? -sum : sum) / 100n +
      "." +
      String((sum < 0n ? -sum : sum) % 100n).padStart(2, "0"),
    metadata = {
      mapping: {
        mode: "SIGNED",
        skipRows: 0,
        dateColumn: 0,
        dateFormat: "ISO",
        amountColumn: 1,
        positiveMeans: "RECEIPT",
        descriptionColumn: 2,
        referenceColumn: null,
      },
      startDate: p.start,
      endDate: bankPeriod.end,
      openingBalance: "0.00",
      closingBalance: total,
      currency: "PKR",
    },
    preview = await previewStatement(people.owner, u.upload!.id, metadata);
  v = await proof();
  const imported = await importStatement(
      v.actor,
      v.proof,
      u.upload!.id,
      {
        ...metadata,
        basisHash: preview.basisHash,
        expectedVersion: preview.uploadVersion,
        acknowledgedRows: [],
        duplicateReview: "",
        reason: "Explicit reviewed synthetic import",
      },
      crypto.randomUUID(),
    ),
    batch = await statementBatch(people.owner, imported.id!);
  const movements = [];
  for (const amount of cashAmounts) {
    const m = await move("CREATE", {
      kind: "TRANSFER",
      fromCashId: payment ? b : from,
      toCashId: payment ? from : b,
      amount,
      reference: prefix + " transfer " + ++count,
      documentDate: p.start,
      postingDate: p.start,
      description: "Actual synthetic transfer",
      evidence: "Explicit synthetic source",
      reason: "Create synthetic transfer",
    });
    const posted = await move("POST", {
      id: m.id,
      expectedVersion: m.version,
      reason: "Explicit synthetic cash posting",
    });
    const journal = await db.financeJournalEntry.findUniqueOrThrow({
      where: { movementId: posted.id },
      include: { lines: true },
    });
    const mapping = await db.financeCashAccount.findUniqueOrThrow({
      where: { id: b },
    });
    movements.push({
      id: m.id,
      version: posted.version,
      cash: journal.lines.find((l) => l.accountId === mapping.glAccountId)!.id,
      opposite: journal.lines.find((l) => l.accountId !== mapping.glAccountId)!
        .id,
    });
  }
  return {
    p,
    bankPeriod,
    b,
    from,
    batch: batch.item,
    statements: batch.lines,
    movements,
  };
}
const allocation = (
  f: Awaited<ReturnType<typeof fixture>>,
  amount = "10.01",
  s = 0,
  c = 0,
) => ({
  statementLineId: f.statements[s].id,
  journalLineId: f.movements[c].cash,
  amount,
});
async function body(
  f: Awaited<ReturnType<typeof fixture>>,
  allocations = [allocation(f)],
) {
  const p = await bankMatchPreview(people.owner, {
    cashAccountId: f.b,
    allocations,
  });
  return {
    cashAccountId: f.b,
    allocations,
    basisHash: p.basisHash,
    description: "Explicit synthetic bank associations",
    evidence: "Bank value dates compared to posted cash",
    reason: "Review exact allocations on both sides",
  };
}
async function undo(id: string, expectedVersion = 2) {
  return command("UNMATCH", {
    id,
    expectedVersion,
    reason: "Correct association while retaining both events",
  });
}
const {
  reconciliationCommand,
  reconciliationDetail,
  reconciliations,
  reconciliationPeers,
} = await import("@/modules/finance/treasury/reconciliation/service");
async function recon(
  action: Parameters<typeof reconciliationCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return reconciliationCommand(v.actor, v.proof, action, input, key);
}
const createBody = (
  f: Awaited<ReturnType<typeof fixture>>,
  patch: Record<string, unknown> = {},
) => ({
  mode: "STATEMENT",
  cashAccountId: f.b,
  statementBatchId: f.batch.id,
  evidence: "Reviewed synthetic statement balance and actual cash cutoff",
  reason: "Explicit source-to-ledger reconciliation review",
  ...patch,
});
const actionBody = (id: string, expectedVersion: number) => ({
  id,
  expectedVersion,
  reason: "Explicit reviewed reconciliation operation",
});
async function matched(amounts = ["10.01"], cash = amounts, payment = false) {
  const f = await fixture(amounts, cash, false, payment);
  await command(
    "MATCH",
    await body(f, [allocation(f, amounts[0].replace("-", ""))]),
  );
  return f;
}
async function documentAll(id: string) {
  const d = await reconciliationDetail(people.owner, id);
  return recon("NOTES", {
    ...actionBody(id, d.item.version),
    notes: d.review.items
      .filter((i) => i.source.kind === "CASH")
      .map((i) => ({
        rowKey: i.key,
        kind: "DOCUMENT",
        note: "Actual outstanding cash will clear on a later bank statement",
        peerStatementLineId: null,
      })),
  });
}
it("exact statement-to-GL equation and documented partial deposit finalize without GL or fabricated settlement", async () => {
  const f = await matched(["4.00"], ["10.01"]),
    before = await db.financeJournalEntry.count(),
    r = await recon("CREATE", createBody(f)),
    d = await reconciliationDetail(people.owner, r.id);
  expect(d.review.totals).toMatchObject({
    closingStatementBalance: "4.00",
    glBankBalance: "10.01",
    outstandingDeposits: "6.01",
    outstandingPayments: "0.00",
    explainedDifference: "0.00",
  });
  expect(d.review.undocumentedCount).toBe(1);
  await expect(recon("FINALIZE", actionBody(r.id, 1))).rejects.toMatchObject({
    code: "FINANCE_RECON_DOCUMENTATION",
  });
  await documentAll(r.id);
  await recon("FINALIZE", actionBody(r.id, 2));
  const final = await reconciliationDetail(people.owner, r.id);
  expect(final.item.state).toBe("FINALIZED");
  expect(final.item.finalizedBy!.displayName).toBe("owner");
  expect(final.review.generatedAt).toBeTruthy();
  expect(await db.financeJournalEntry.count()).toBe(before);
  expect(final.item).not.toHaveProperty("sourceProof");
  expect(final.item).not.toHaveProperty("finalSnapshot");
});
it("unequal bank-to-GL equation and unresolved bank evidence cannot be finalized", async () => {
  const f = await fixture(),
    r = await recon("CREATE", createBody(f)),
    d = await reconciliationDetail(people.owner, r.id);
  expect(d.review.unresolvedCount).toBe(1);
  expect(d.review.totals.explainedDifference).toBe("10.01");
  await documentAll(r.id);
  await expect(recon("FINALIZE", actionBody(r.id, 2))).rejects.toMatchObject({
    code: "FINANCE_RECON_DIFFERENCE",
  });
});
it("actual new posting and matching make a draft stale; explicit refresh clears notes and captures new reviewed source", async () => {
  const f = await fixture(),
    r = await recon("CREATE", createBody(f));
  await documentAll(r.id);
  await command("MATCH", await body(f));
  expect(
    (await reconciliationDetail(people.owner, r.id)).review.basisStale,
  ).toBe(true);
  await expect(recon("FINALIZE", actionBody(r.id, 2))).rejects.toMatchObject({
    code: "FINANCE_RECON_STALE",
  });
  await recon("REFRESH", actionBody(r.id, 2));
  const d = await reconciliationDetail(people.owner, r.id);
  expect(d.review).toMatchObject({
    basisStale: false,
    total: 0,
    undocumentedCount: 0,
    unresolvedCount: 0,
  });
  expect(
    await db.financeReconciliationNote.count({
      where: { reconciliationId: r.id },
    }),
  ).toBe(0);
  await recon("FINALIZE", actionBody(r.id, 3));
  expect(
    await db.financeAuditEvent.count({
      where: { entityId: r.id, action: "FINANCE_RECON_REFRESH" },
    }),
  ).toBe(1);
});
it("cash posting dates and later bank value dates preserve earlier cutoff proof and permit later matching", async () => {
  const f = await fixture(),
    r = await recon("CREATE", {
      mode: "ZERO_ACTIVITY",
      cashAccountId: f.b,
      startDate: f.p.start,
      cutoffDate: f.p.start,
      openingBalance: "0.00",
      closingBalance: "0.00",
      evidence: "No bank activity on earlier cash posting date",
      reason: "Review exact earlier cutoff",
    });
  await documentAll(r.id);
  await recon("FINALIZE", actionBody(r.id, 2));
  const before = await db.financeReconciliation.findUniqueOrThrow({
    where: { id: r.id },
  });
  await command("MATCH", await body(f));
  const after = await db.financeReconciliation.findUniqueOrThrow({
    where: { id: r.id },
  });
  expect(after.finalSnapshot).toEqual(before.finalSnapshot);
  expect(
    (await reconciliationDetail(people.owner, r.id)).review.totals
      .outstandingDeposits,
  ).toBe("10.01");
});
it("finalized proof blocks historical cash, original-date unmatch and source void; owner reopen retains snapshot and unlocks correction", async () => {
  const f = await matched(),
    m = await db.financeBankMatch.findFirstOrThrow({
      where: { cashAccountId: f.b, state: "MATCHED" },
    }),
    r = await recon("CREATE", createBody(f));
  await recon("FINALIZE", actionBody(r.id, 1));
  const retained = await db.financeReconciliation.findUniqueOrThrow({
    where: { id: r.id },
  });
  await expect(undo(m.id)).rejects.toMatchObject({
    code: "FINANCE_RECON_CLOSED",
  });
  const extra = await move("CREATE", {
    kind: "TRANSFER",
    fromCashId: f.from,
    toCashId: f.b,
    amount: "1.00",
    reference: prefix + " extra " + ++count,
    documentDate: f.p.start,
    postingDate: f.p.start,
    description: "Backdated cash cannot alter finalized proof",
    evidence: "Isolated synthetic source",
    reason: "Test reconciliation barrier",
  });
  await expect(
    move("POST", {
      id: extra.id,
      expectedVersion: extra.version,
      reason: "Attempt backdated posting",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_RECON_CLOSED" });
  await expect(
    recon("REOPEN", actionBody(r.id, 2), crypto.randomUUID(), "selected"),
  ).rejects.toMatchObject({ code: "FINANCE_OWNER_REQUIRED" });
  await recon("REOPEN", actionBody(r.id, 2));
  expect(
    (await db.financeReconciliation.findUniqueOrThrow({ where: { id: r.id } }))
      .finalSnapshot,
  ).toEqual(retained.finalSnapshot);
  await undo(m.id);
  const v = await proof();
  await statementAction(
    v.actor,
    v.proof,
    "VOID",
    f.batch.id,
    {
      expectedVersion: 2,
      reason: "Retain corrected source after owner reopening",
    },
    crypto.randomUUID(),
  );
});
it("zero-activity evidence requires equal balances/no imported activity and can finalize a genuine empty bank without GL", async () => {
  const p = await newPeriod(),
    b = await bank(),
    before = await db.financeJournalEntry.count(),
    create = {
      mode: "ZERO_ACTIVITY",
      cashAccountId: b,
      startDate: p.start,
      cutoffDate: p.end,
      openingBalance: "0.00",
      closingBalance: "0.00",
      evidence: "Actual synthetic bank had no transactions",
      reason: "Review no-activity bank period",
    };
  await expect(
    recon("CREATE", { ...create, closingBalance: "1.00" }),
  ).rejects.toMatchObject({ code: "FINANCE_RECON_ZERO_ACTIVITY" });
  const r = await recon("CREATE", create);
  await recon("FINALIZE", actionBody(r.id, 1));
  expect(await db.financeJournalEntry.count()).toBe(before);
  const active = await fixture();
  await expect(
    recon("CREATE", {
      ...create,
      cashAccountId: active.b,
      startDate: active.p.start,
      cutoffDate: active.p.end,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_RECON_ZERO_ACTIVITY" });
});
it("retained duplicate exclusion requires exact source identity and a fully matched peer; originals stay in proof", async () => {
  const f = await matched(),
    bytes = Buffer.from(
      "Date,Amount,Description\r\n" + f.p.end + ",10.01,Reviewed record 0\r\n",
    ),
    hash = createHash("sha256").update(bytes).digest("hex");
  let v = await proof();
  const u = await reserveStatement(
    v.actor,
    v.proof,
    {
      cashAccountId: f.b,
      fileName: "reviewed-duplicate.csv",
      byteSize: bytes.length,
      sha256: hash,
      reason: "Retain explicitly reviewed duplicate source",
    },
    crypto.randomUUID(),
  );
  await uploadStatementChunk(people.owner, u.upload!.id, {
    index: 0,
    content: bytes.toString("base64"),
    sha256: hash,
    intent: u.intent,
  });
  const meta = {
      mapping: {
        mode: "SIGNED",
        skipRows: 0,
        dateColumn: 0,
        dateFormat: "ISO",
        amountColumn: 1,
        positiveMeans: "RECEIPT",
        descriptionColumn: 2,
        referenceColumn: null,
      },
      startDate: f.p.start,
      endDate: f.p.end,
      openingBalance: "0.00",
      closingBalance: "10.01",
      currency: "PKR",
    },
    preview = await previewStatement(people.owner, u.upload!.id, meta);
  v = await proof();
  const imported = await importStatement(
      v.actor,
      v.proof,
      u.upload!.id,
      {
        ...meta,
        basisHash: preview.basisHash,
        expectedVersion: preview.uploadVersion,
        acknowledgedRows: preview.duplicateRows,
        duplicateReview: "Same retained bank transaction in another export",
        reason: "Keep both reviewed file records",
      },
      crypto.randomUUID(),
    ),
    r = await recon("CREATE", createBody(f, { statementBatchId: imported.id })),
    d = await reconciliationDetail(people.owner, r.id);
  expect(d.review.totals.explainedDifference).toBe("0.00");
  await expect(recon("FINALIZE", actionBody(r.id, 1))).rejects.toMatchObject({
    code: "FINANCE_RECON_UNRESOLVED",
  });
  const peers = await reconciliationPeers(people.owner, r.id, {
    rowKey: d.review.items[0].key,
  });
  expect(peers.items[0].id).toBe(f.statements[0].id);
  await expect(
    recon("NOTES", {
      ...actionBody(r.id, 1),
      notes: [
        {
          rowKey: d.review.items[0].key,
          kind: "EXCLUDE_DUPLICATE",
          note: "Unreviewed self exclusion",
          peerStatementLineId: d.review.items[0].source.id,
        },
      ],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_RECON_DUPLICATE" });
  await recon("NOTES", {
    ...actionBody(r.id, 1),
    notes: [
      {
        rowKey: d.review.items[0].key,
        kind: "EXCLUDE_DUPLICATE",
        note: "Explicit reviewed duplicate of the fully matched original export",
        peerStatementLineId: peers.items[0].id,
      },
    ],
  });
  await recon("FINALIZE", actionBody(r.id, 2));
  const final = await reconciliationDetail(people.owner, r.id);
  expect(final.review).toMatchObject({ total: 1, unresolvedCount: 0 });
  expect(final.review.items[0].remaining).toBe("10.01");
  expect(final.review.items[0].review?.kind).toBe("EXCLUDE_DUPLICATE");
});
it("idempotency, optimistic versions, retained void/replacement and no-fork constraints hold", async () => {
  const f = await matched(),
    b = createBody(f),
    key = crypto.randomUUID(),
    r = await recon("CREATE", b, key);
  expect(await recon("CREATE", b, key)).toEqual(r);
  await expect(
    recon("CREATE", { ...b, evidence: "Different evidence" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  await expect(recon("FINALIZE", actionBody(r.id, 2))).rejects.toMatchObject({
    code: "FINANCE_STALE_VERSION",
  });
  await recon("VOID", actionBody(r.id, 1));
  await expect(recon("CREATE", b)).rejects.toMatchObject({
    code: "FINANCE_RECON_REPLACEMENT",
  });
  const replacement = await recon("CREATE", {
    ...b,
    replacesId: r.id,
    expectedPriorVersion: 2,
  });
  expect(
    (await reconciliationDetail(people.owner, replacement.id)).item.replaces
      ?.id,
  ).toBe(r.id);
  await expect(
    recon("CREATE", { ...b, replacesId: r.id, expectedPriorVersion: 2 }),
  ).rejects.toThrow();
});
it("owner must reopen later bank cutoffs first and all issued snapshots remain retained", async () => {
  const b = await bank(),
    p = await newPeriod(),
    body = {
      mode: "ZERO_ACTIVITY",
      cashAccountId: b,
      startDate: p.start,
      cutoffDate: p.start,
      openingBalance: "0.00",
      closingBalance: "0.00",
      evidence: "Reviewed no-activity bank source",
      reason: "Explicit cutoff review",
    },
    early = await recon("CREATE", body);
  await recon("FINALIZE", actionBody(early.id, 1));
  const late = await recon("CREATE", { ...body, cutoffDate: p.end });
  await recon("FINALIZE", actionBody(late.id, 1));
  await expect(recon("REOPEN", actionBody(early.id, 2))).rejects.toMatchObject({
    code: "FINANCE_RECON_REOPEN_ORDER",
  });
  await recon("REOPEN", actionBody(late.id, 2));
  await recon("REOPEN", actionBody(early.id, 2));
  expect(
    (
      await db.financeReconciliation.findUniqueOrThrow({
        where: { id: early.id },
      })
    ).finalSnapshot,
  ).not.toBeNull();
});
it("current lower roles/unselected super admin and revoked grant cannot read report/peers or write", async () => {
  const f = await matched(),
    r = await recon("CREATE", createBody(f));
  for (const who of ["hr", "lead", "member", "other"])
    await expect(reconciliationDetail(people[who], r.id)).rejects.toMatchObject(
      { code: "FINANCE_FORBIDDEN" },
    );
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  await expect(reconciliations(people.selected)).rejects.toMatchObject({
    code: "FINANCE_FORBIDDEN",
  });
  env.FINANCE_ENABLED = false;
  try {
    await expect(reconciliations(people.owner)).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("runtime/Data API writes, internal helpers and forged final/source snapshots are rejected", async () => {
  const f = await matched(),
    r = await recon("CREATE", createBody(f)),
    c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"])
      expect(
        (
          await c.query(
            `SELECT has_table_privilege($1,'"FinanceReconciliation"','UPDATE') AS write,has_function_privilege($1,'encova_finance_reconciliation_prepare(uuid,uuid,date,date,numeric,numeric)','EXECUTE') AS helper`,
            [role],
          )
        ).rows[0],
      ).toEqual({ write: false, helper: false });
  } finally {
    await c.end();
  }
  await expect(
    db.financeReconciliation.update({
      where: { id: r.id },
      data: {
        state: "FINALIZED",
        version: { increment: 1 },
        finalizedAt: new Date(),
        finalizedById: people.owner.id,
        finalSnapshot: { forged: true },
      },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeReconciliation.update({
      where: { id: r.id },
      data: { cashAccountId: f.from, version: { increment: 1 } },
    }),
  ).rejects.toThrow();
});
it("concurrent confirmations retain one final snapshot and one successful version", async () => {
  const f = await matched(),
    r = await recon("CREATE", createBody(f)),
    out = await Promise.allSettled([
      recon("FINALIZE", actionBody(r.id, 1)),
      recon("FINALIZE", actionBody(r.id, 1)),
    ]);
  expect(out.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(
    (out.find((x) => x.status === "rejected") as PromiseRejectedResult).reason
      .code,
  ).toBe("FINANCE_STALE_VERSION");
  expect((await reconciliationDetail(people.owner, r.id)).item.state).toBe(
    "FINALIZED",
  );
});

it("outstanding payment uses credit direction and subtracts from the statement balance", async () => {
  const f = await matched(["-4.00"], ["10.01"], true),
    r = await recon("CREATE", createBody(f)),
    d = await reconciliationDetail(people.owner, r.id);
  expect(d.review.totals).toMatchObject({
    closingStatementBalance: "-4.00",
    glBankBalance: "-10.01",
    outstandingDeposits: "0.00",
    outstandingPayments: "6.01",
    explainedDifference: "0.00",
  });
  await documentAll(r.id);
  await recon("FINALIZE", actionBody(r.id, 2));
});
it("zero-net unresolved receipts/payments cannot disappear through netting even when the equation is zero", async () => {
  const f = await fixture(["10.01", "-10.01"], ["10.01"]),
    m = await move("CREATE", {
      kind: "TRANSFER",
      fromCashId: f.b,
      toCashId: f.from,
      amount: "10.01",
      reference: prefix + " outgoing " + ++count,
      documentDate: f.p.start,
      postingDate: f.p.start,
      description: "Actual synthetic payment",
      evidence: "Reviewed actual outgoing cash",
      reason: "Explicit synthetic cash payment",
    });
  await move("POST", {
    id: m.id,
    expectedVersion: m.version,
    reason: "Post actual synthetic cash payment",
  });
  const r = await recon("CREATE", createBody(f));
  await documentAll(r.id);
  const d = await reconciliationDetail(people.owner, r.id);
  expect(d.review.totals.explainedDifference).toBe("0.00");
  expect(d.review.unresolvedCount).toBe(2);
  await expect(recon("FINALIZE", actionBody(r.id, 2))).rejects.toMatchObject({
    code: "FINANCE_RECON_UNRESOLVED",
  });
});
it("review rows are stable 25-item pages with bounded source summaries", async () => {
  const f = await fixture(
      ["10.01"],
      Array.from({ length: 26 }, () => "1.00"),
    ),
    r = await recon("CREATE", createBody(f)),
    one = await reconciliationDetail(people.owner, r.id),
    two = await reconciliationDetail(people.owner, r.id, { page: 2 });
  expect(one.review).toMatchObject({ total: 27, page: 1, pages: 2 });
  expect(one.review.items).toHaveLength(25);
  expect(two.review.items).toHaveLength(2);
  expect(
    new Set([...one.review.items, ...two.review.items].map((i) => i.key)).size,
  ).toBe(27);
  expect(JSON.stringify(one).length).toBeLessThan(250000);
}, 25000);
it("a finalized empty bank cannot be silently remapped or gain backdated statement evidence before owner reopening", async () => {
  const p = await newPeriod(),
    b = await bank(),
    r = await recon("CREATE", {
      mode: "ZERO_ACTIVITY",
      cashAccountId: b,
      startDate: p.start,
      cutoffDate: p.end,
      openingBalance: "0.00",
      closingBalance: "0.00",
      evidence: "Reviewed no-activity source",
      reason: "Explicit synthetic no-activity proof",
    });
  await recon("FINALIZE", actionBody(r.id, 1));
  const original = await db.financeCashAccount.findUniqueOrThrow({
      where: { id: b },
    }),
    other = await account({ controlType: "CASH" });
  await expect(
    master("CASH_UPDATE", {
      id: b,
      expectedVersion: original.version,
      name: original.name,
      kind: original.kind,
      glAccountId: other,
      currency: "PKR",
      maskedReference: original.maskedReference,
      reason: "Attempt historical bank remapping",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_MASTER_USED" });
  const bytes = Buffer.from(
      "Date,Amount,Description\n" +
        p.end +
        ",1.00,Newly discovered real bank deposit\n",
    ),
    sha = createHash("sha256").update(bytes).digest("hex");
  let v = await proof();
  const u = await reserveStatement(
    v.actor,
    v.proof,
    {
      cashAccountId: b,
      fileName: "discovered.csv",
      byteSize: bytes.length,
      sha256: sha,
      reason: "Retain discovered bank evidence",
    },
    crypto.randomUUID(),
  );
  await uploadStatementChunk(people.owner, u.upload!.id, {
    index: 0,
    content: bytes.toString("base64"),
    sha256: sha,
    intent: u.intent,
  });
  const meta = {
      mapping: {
        mode: "SIGNED",
        skipRows: 0,
        dateColumn: 0,
        dateFormat: "ISO",
        amountColumn: 1,
        positiveMeans: "RECEIPT",
        descriptionColumn: 2,
        referenceColumn: null,
      },
      startDate: p.start,
      endDate: p.end,
      openingBalance: "0.00",
      closingBalance: "1.00",
      currency: "PKR",
    },
    preview = await previewStatement(people.owner, u.upload!.id, meta),
    input = {
      ...meta,
      basisHash: preview.basisHash,
      expectedVersion: preview.uploadVersion,
      acknowledgedRows: [],
      duplicateReview: "",
      reason: "Reviewed discovered historical bank source",
    },
    key = crypto.randomUUID();
  v = await proof();
  await expect(
    importStatement(v.actor, v.proof, u.upload!.id, input, key),
  ).rejects.toMatchObject({ code: "FINANCE_RECON_CLOSED" });
  await recon("REOPEN", actionBody(r.id, 2));
  v = await proof();
  expect(
    (await importStatement(v.actor, v.proof, u.upload!.id, input, key)).id,
  ).toBeTruthy();
});
