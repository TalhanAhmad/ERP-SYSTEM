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
  prefix = "BM31." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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
const {
  bankMatchCommand,
  bankMatchPreview,
  bankMatchOptions,
  bankMatchDetail,
  bankMatches,
} = await import("@/modules/finance/treasury/matching/service");
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
    total = sum / 100n + "." + String(sum % 100n).padStart(2, "0"),
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
      fromCashId: from,
      toCashId: b,
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
it("one statement matches multiple actual cash entries with exact residuals and intrinsic value dates; unmatch retains opposites without GL", async () => {
  const f = await fixture(["10.01"], ["4.00", "6.01"]),
    before = await db.financeJournalEntry.count(),
    b = await body(f, [allocation(f, "4.00"), allocation(f, "6.01", 0, 1)]),
    m = await command("MATCH", b),
    d = await bankMatchDetail(people.owner, m.id);
  expect(d.allocations.map((a) => a.effectiveDate)).toEqual([f.p.end, f.p.end]);
  expect(d.allocations.map((a) => a.amount)).toEqual(["4.00", "6.01"]);
  expect(
    (
      await bankMatchOptions(people.owner, {
        kind: "STATEMENT",
        cashAccountId: f.b,
      })
    ).total,
  ).toBe(0);
  await undo(m.id);
  const corrected = await bankMatchDetail(people.owner, m.id);
  expect(corrected.item.state).toBe("UNMATCHED");
  expect(
    corrected.allocations.every(
      (a) =>
        a.events.length === 2 && a.events[1].effectiveDate === a.effectiveDate,
    ),
  ).toBe(true);
  expect(
    (
      await bankMatchOptions(people.owner, {
        kind: "STATEMENT",
        cashAccountId: f.b,
      })
    ).items[0].remaining,
  ).toBe("10.01");
  expect(await db.financeJournalEntry.count()).toBe(before);
});
it("many statement records can match one cash leg and both-side aggregate capacity is enforced", async () => {
  const f = await fixture(["4.00", "6.01"], ["10.01"]);
  await expect(
    bankMatchPreview(people.owner, {
      cashAccountId: f.b,
      allocations: [allocation(f, "4.00"), allocation(f, "6.02", 1)],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_BANK_MATCH_CAPACITY" });
  const m = await command(
    "MATCH",
    await body(f, [allocation(f, "4.00"), allocation(f, "6.01", 1)]),
  );
  expect(
    (await bankMatchOptions(people.owner, { kind: "CASH", cashAccountId: f.b }))
      .total,
  ).toBe(0);
  await undo(m.id);
});
it("partial matching spans separate groups while residual limits prevent over-allocation", async () => {
  const f = await fixture(),
    m = await command("MATCH", await body(f, [allocation(f, "4.00")]));
  const p = await bankMatchOptions(people.owner, {
    kind: "CASH",
    cashAccountId: f.b,
  });
  expect(p.items[0]).toMatchObject({ allocated: "4.00", remaining: "6.01" });
  await expect(body(f, [allocation(f, "6.02")])).rejects.toMatchObject({
    code: "FINANCE_BANK_MATCH_CAPACITY",
  });
  await command("MATCH", await body(f, [allocation(f, "6.01")]));
  await undo(m.id);
  expect(
    (await bankMatchOptions(people.owner, { kind: "CASH", cashAccountId: f.b }))
      .items[0].remaining,
  ).toBe("4.00");
});
it("stale previews fail even when match/unmatch history returns to the same residual", async () => {
  const f = await fixture(),
    stale = await body(f),
    m = await command("MATCH", await body(f, [allocation(f, "1.00")]));
  await undo(m.id);
  await expect(command("MATCH", stale)).rejects.toMatchObject({
    code: "FINANCE_BANK_MATCH_STALE",
  });
  await command("MATCH", await body(f));
});
it("idempotent retry retains a single group/audit and conflicting input is rejected", async () => {
  const f = await fixture(),
    b = await body(f),
    key = crypto.randomUUID(),
    m = await command("MATCH", b, key);
  expect(await command("MATCH", b, key)).toEqual(m);
  await expect(
    command("MATCH", { ...b, evidence: "Different reviewed evidence" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  expect(
    await db.financeAuditEvent.count({
      where: { entityId: m.id, action: "FINANCE_BANK_MATCH" },
    }),
  ).toBe(1);
});
it("cash reversal and statement void are blocked until active matching is resolved", async () => {
  const f = await fixture(),
    m = await command("MATCH", await body(f));
  await expect(
    move("REVERSE", {
      id: f.movements[0].id,
      expectedVersion: f.movements[0].version,
      postingDate: f.p.end,
      reason: "Reverse synthetic incorrect original",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_MATCHED_CASH" });
  let v = await proof();
  await expect(
    statementAction(
      v.actor,
      v.proof,
      "VOID",
      f.batch.id,
      { expectedVersion: 2, reason: "Correct retained evidence" },
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_MATCHED_STATEMENT" });
  await undo(m.id);
  await move("REVERSE", {
    id: f.movements[0].id,
    expectedVersion: f.movements[0].version,
    postingDate: f.p.end,
    reason: "Reverse after resolved association",
  });
  v = await proof();
  await statementAction(
    v.actor,
    v.proof,
    "VOID",
    f.batch.id,
    { expectedVersion: 2, reason: "Correct retained evidence" },
    crypto.randomUUID(),
  );
});
it("direction, unrelated bank, repeated pairs, and client-claimed source values are rejected", async () => {
  const f = await fixture();
  await expect(
    bankMatchPreview(people.owner, {
      cashAccountId: f.b,
      allocations: [
        { ...allocation(f), journalLineId: f.movements[0].opposite },
      ],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_BANK_MATCH_SOURCE" });
  await expect(
    bankMatchPreview(people.owner, {
      cashAccountId: f.from,
      allocations: [allocation(f)],
    }),
  ).rejects.toMatchObject({ code: "FINANCE_BANK_MATCH_SOURCE" });
  await expect(
    body(f, [allocation(f, "1.00"), allocation(f, "1.00")]),
  ).rejects.toThrow();
  await expect(
    bankMatchPreview(people.owner, {
      cashAccountId: f.b,
      allocations: [{ ...allocation(f), remaining: "1000.00" }],
    }),
  ).rejects.toThrow();
});
it("unmatch rejects stale version, closed intrinsic period, and repeated state transition", async () => {
  const f = await fixture(),
    m = await command("MATCH", await body(f));
  await expect(undo(m.id, 1)).rejects.toMatchObject({
    code: "FINANCE_STALE_VERSION",
  });
  const p = await db.financePeriod.findUniqueOrThrow({ where: { id: f.p.id } });
  // Closed-state fault fixture is transaction-local and rolled back; actual owner closing has separate F39 coverage.
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      'ALTER TABLE "FinancePeriod" DISABLE TRIGGER "FinancePeriod_guard"',
    );
    await c.query(
      'UPDATE "FinancePeriod" SET state=\'CLOSED\',"closedAt"=CURRENT_TIMESTAMP,"closedById"=$2 WHERE id=$1',
      [p.id, people.owner.id],
    );
    await c.query("SET CONSTRAINTS ALL IMMEDIATE");
    await c.query(
      'ALTER TABLE "FinancePeriod" ENABLE TRIGGER "FinancePeriod_guard"',
    );
    const session = (
      await c.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [people.owner.authUserId],
      )
    ).rows[0];
    await expect(
      c.query(
        "SELECT encova_finance_bank_match_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'UNMATCH',$3,$4,$5)",
        [
          people.owner.id,
          session.id,
          JSON.stringify({
            id: m.id,
            expectedVersion: 2,
            reason: "Check closed intrinsic period",
          }),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ message: "FINANCE_PERIOD_UNAVAILABLE" });
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
  await undo(m.id);
  await expect(undo(m.id, 3)).rejects.toMatchObject({
    code: "FINANCE_BANK_MATCH_IMMUTABLE",
  });
});
it("lower roles, unselected super admin, revoked grant and disabled flag cannot read or write matching", async () => {
  const f = await fixture(),
    b = await body(f);
  for (const who of ["hr", "lead", "member", "other"])
    await expect(
      bankMatchOptions(people[who], { kind: "CASH", cashAccountId: f.b }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  const m = await command("MATCH", b, crypto.randomUUID(), "selected");
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  await expect(bankMatchDetail(people.selected, m.id)).rejects.toMatchObject({
    code: "FINANCE_FORBIDDEN",
  });
  env.FINANCE_ENABLED = false;
  try {
    await expect(bankMatches(people.owner)).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("runtime and Data API roles cannot mutate history or invoke internal source helpers", async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE encova_app");
    await expect(
      c.query("SELECT encova_finance_bank_match_source($1,$2)", [
        "CASH",
        crypto.randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await c.query("ROLLBACK");
    for (const role of ["encova_app", "anon", "authenticated"]) {
      const privileges = (
        await c.query(
          `SELECT has_table_privilege($1,'"FinanceBankMatchEvent"','INSERT') AS insert,has_table_privilege($1,'"FinanceBankMatch"','UPDATE') AS update`,
          [role],
        )
      ).rows[0];
      expect(privileges).toEqual({ insert: false, update: false });
    }
  } finally {
    await c.end();
  }
});
it("source allocations and events resist privileged rewriting and forged unmatch without root transition", async () => {
  const f = await fixture(),
    m = await command("MATCH", await body(f)),
    a = await db.financeBankMatchAllocation.findFirstOrThrow({
      where: { matchId: m.id },
    });
  await expect(
    db.financeBankMatchAllocation.update({
      where: { id: a.id },
      data: { amount: "1.00" },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeBankMatchEvent.deleteMany({ where: { allocationId: a.id } }),
  ).rejects.toThrow();
  await expect(
    db.financeBankMatchEvent.create({
      data: {
        allocationId: a.id,
        kind: "UNMATCH",
        delta: "-10.01",
        effectiveDate: a.effectiveDate,
        createdById: people.owner.id,
        reason: "Forged opposite without group correction",
      },
    }),
  ).rejects.toThrow();
});
it("concurrent confirmations cannot exceed either source residual", async () => {
  const f = await fixture(),
    b = await body(f),
    results = await Promise.allSettled([
      command("MATCH", b),
      command("MATCH", b),
    ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.code,
  ).toBe("FINANCE_BANK_MATCH_CAPACITY");
});

it("nonposting match retains its later effective period and prevents voiding that period", async () => {
  const f = await fixture(["10.01"], ["10.01"], true);
  expect(
    (
      await db.financePeriod.findUniqueOrThrow({
        where: { id: f.bankPeriod.id },
      })
    ).usedAt,
  ).toBeNull();
  const m = await command("MATCH", await body(f));
  const p = await db.financePeriod.findUniqueOrThrow({
    where: { id: f.bankPeriod.id },
  });
  expect(p.usedAt).not.toBeNull();
  await expect(
    config("PERIOD_VOID", {
      id: p.id,
      expectedVersion: p.version,
      reason: "Cannot discard matched effective interval",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PERIOD_USED" });
  expect(
    (await bankMatchDetail(people.owner, m.id)).allocations[0].effectiveDate,
  ).toBe(f.bankPeriod.end);
});
