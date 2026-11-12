import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import pg from "pg";
import { readFile } from "node:fs/promises";
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
const { setupOwner, accessCommand } =
  await import("@/modules/finance/access/service");
const { setupCommand } = await import("@/modules/finance/accounting/service");
const { ledgerCommand, journalDetail, journals } =
  await import("@/modules/finance/ledger/service");
const { ledgerRead, ledgerMutation } =
  await import("@/modules/finance/ledger/http");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {};
const suffix = crypto.randomUUID().slice(0, 7).toUpperCase(),
  prefix = `L06.${suffix}`;
const password = "Ledger-synthetic-test-only-9#";
let counter = 0;
let period: { id: string; start: string; end: string },
  asset: string,
  expense: string,
  liability: string,
  control: string,
  parent: string;
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const request = (who = "owner", body?: unknown, key = crypto.randomUUID()) =>
  new Request(env.APP_URL + "/api/v1/finance/journals", {
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
  verifyFinanceReauthentication(request(who), { password });
async function command(
  action: Parameters<typeof ledgerCommand>[2],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return ledgerCommand(v.actor, v.proof, action, body, key);
}
async function config(
  action: Parameters<typeof setupCommand>[2],
  body: unknown,
) {
  const v = await proof();
  return setupCommand(v.actor, v.proof, action, body, crypto.randomUUID());
}
async function account(patch: Record<string, unknown> = {}) {
  return (
    await config("ACCOUNT_CREATE", {
      code: `${prefix}.${++counter}`,
      name: `${prefix} account ${counter}`,
      type: "ASSET",
      normalSide: "DEBIT",
      reportGroup: "CURRENT_ASSETS",
      controlType: "NONE",
      currency: "PKR",
      parentId: null,
      isPosting: true,
      isContra: false,
      isCashEquivalent: false,
      reason: "Explicit synthetic ledger mapping",
      ...patch,
    })
  ).id;
}
async function newPeriod() {
  const rows = await db.$queryRaw<
    { start: Date }[]
  >`SELECT d::date AS start FROM generate_series(DATE '1900-01-01',DATE '1950-01-01',interval '10 days') d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]') && daterange(d::date,(d+interval '9 days')::date,'[]')) ORDER BY d LIMIT 1`;
  if (!rows.length) throw new Error("No unused historical test interval");
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
        reason: "Isolated historical journal fixture",
      })
    ).id,
    start,
    end,
  };
}
const body = (patch: Record<string, unknown> = {}) => ({
  reference: `${prefix}.${++counter}`,
  description: "Synthetic accrual adjustment",
  evidence: "Fixture evidence reference; no real receipt",
  postingDate: period.start,
  currency: "PKR",
  reason: "Reviewed synthetic accounting fixture",
  lines: [
    {
      accountId: expense,
      description: "Recognize expense",
      debit: "120000.00",
      credit: "0.00",
      projectId: null,
    },
    {
      accountId: liability,
      description: "Accrued cost",
      debit: "0.00",
      credit: "120000.00",
      projectId: null,
    },
  ],
  ...patch,
});
async function release() {
  const s = await db.financeSettings.findFirst();
  const ids = Object.values(people).map((p) => p.id);
  if (s && !ids.includes(s.ownerId))
    throw new Error("Refuse unowned finance singleton cleanup");
  if (s) await db.$executeRawUnsafe('TRUNCATE "FinanceSettings"');
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
    ["member", "MEMBER"],
    ["lead", "TEAM_LEAD"],
  ] as const) {
    const email = `${prefix.toLowerCase()}.${name}@example.test`;
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
        authUserId: signed.user.id,
        username: `${prefix.toLowerCase()}.${name}`,
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
    "Explicit synthetic ledger owner",
  );
  await db.financeGrant.create({
    data: {
      userId: people.selected.id,
      grantedById: people.owner.id,
      reason: "Explicit ledger tester",
    },
  });
  parent = await account({ isPosting: false });
  asset = await account({ parentId: parent });
  expense = await account({
    type: "OPERATING_EXPENSE",
    reportGroup: "OPERATING_EXPENSES",
  });
  liability = await account({
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
  });
  control = await account({ controlType: "CASH" });
  period = await newPeriod();
}, 30000);
afterAll(async () => {
  await release();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("denies every unselected role before list/detail filters and HTTP mutation", async () => {
  for (const who of ["other", "hr", "member", "lead"]) {
    await expect(
      journals(people[who], { invalid: true }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    await expect(
      journalDetail(people[who], crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    expect(
      (
        await ledgerMutation(
          request(who, { ...body(), reauth: { password } }),
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
});
it("allows selected administrators to save and post exact balanced journals with retained source/history", async () => {
  const d = await command("CREATE", body(), undefined, "selected");
  const result = await command(
    "POST",
    { id: d.id, expectedVersion: 1, reason: "Post balanced accrual" },
    undefined,
    "selected",
  );
  const detail = await journalDetail(people.selected, d.id);
  expect(detail.item.state).toBe("POSTED");
  expect(detail.totals).toEqual({
    debit: "120000.00",
    credit: "120000.00",
    balanced: true,
  });
  expect(detail.item.entry!.id).toBe(result.journalId);
  expect(detail.history).toHaveLength(2);
  expect(
    (await db.financePeriod.findUniqueOrThrow({ where: { id: period.id } }))
      .usedAt,
  ).not.toBeNull();
});
it("requires server-minted proof, canonical strings and strict financial bodies", async () => {
  const v = await proof();
  await expect(
    ledgerCommand(
      v.actor,
      {} as typeof v.proof,
      "CREATE",
      body(),
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_REAUTH_REQUIRED" });
  for (const patch of [
    { total: "1.00" },
    { currency: "USD" },
    { postedById: people.owner.id },
    {
      lines: [
        {
          accountId: asset,
          description: "Invalid number",
          debit: 1,
          credit: "0.00",
        },
      ],
    },
  ])
    await expect(command("CREATE", body(patch))).rejects.toThrow();
});
it("permits unbalanced drafts but rolls back the entire failed posting and receipt", async () => {
  const input = body();
  input.lines[1].credit = "1.00";
  const d = await command("CREATE", input),
    key = crypto.randomUUID();
  await expect(
    command(
      "POST",
      { id: d.id, expectedVersion: 1, reason: "Unbalanced attempt" },
      key,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_UNBALANCED" });
  expect((await journalDetail(people.owner, d.id)).item.state).toBe("DRAFT");
  expect(await db.financeJournalEntry.count({ where: { draftId: d.id } })).toBe(
    0,
  );
  expect(
    await db.financeLedgerReceipt.count({
      where: { actorId: people.owner.id, key },
    }),
  ).toBe(0);
});
it("enforces one positive side, line limits and precision before draft persistence", async () => {
  for (const values of [
    ["0", "0"],
    ["1", "1"],
    ["-1", "0"],
    ["1.001", "0"],
    ["1e2", "0"],
  ])
    await expect(
      command(
        "CREATE",
        body({
          lines: [
            {
              accountId: asset,
              description: "Bad line",
              debit: values[0],
              credit: values[1],
            },
          ],
        }),
      ),
    ).rejects.toThrow();
  await expect(command("CREATE", body({ lines: [] }))).rejects.toThrow();
});
it("rejects protected controls, groups and inactive posting accounts at the database boundary", async () => {
  const archived = await account();
  await config("ACCOUNT_ARCHIVE", {
    id: archived,
    expectedVersion: 1,
    reason: "Retire fixture mapping",
  });
  for (const id of [control, parent, archived]) {
    const input = body();
    input.lines[0].accountId = id;
    const d = await command("CREATE", input);
    await expect(
      command("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Invalid account attempt",
      }),
    ).rejects.toMatchObject({
      code:
        id === control
          ? "FINANCE_CONTROL_PROTECTED"
          : "FINANCE_ACCOUNT_UNAVAILABLE",
    });
  }
  const project = await db.project.create({
    data: {
      name: prefix + " archived project",
      description: "Synthetic ledger guard fixture",
      managerId: people.owner.id,
      archivedAt: new Date(),
    },
  });
  const input = body();
  const d = await command("CREATE", {
    ...input,
    lines: input.lines.map((l, i) => ({
      ...l,
      projectId: i === 0 ? project.id : null,
    })),
  });
  await expect(
    command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Archived project attempt",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PROJECT_UNAVAILABLE" });
});
it("rejects dates outside open periods and future posting dates", async () => {
  const noPeriod = await command("CREATE", body({ postingDate: "1800-01-01" }));
  await expect(
    command("POST", {
      id: noPeriod.id,
      expectedVersion: 1,
      reason: "No period",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PERIOD_UNAVAILABLE" });
  const candidates = await db.$queryRaw<
    { start: Date }[]
  >`SELECT d::date AS start FROM generate_series(DATE '8000-01-01',DATE '8050-01-01',interval '10 days') d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]') && daterange(d::date,d::date,'[]')) ORDER BY d LIMIT 1`;
  const futureDate = candidates[0].start.toISOString().slice(0, 10);
  await config("PERIOD_CREATE", {
    name: prefix + " future-only fixture",
    startDate: futureDate,
    endDate: futureDate,
    reason: "Verify future posting rejection",
  });
  const d = await command("CREATE", body({ postingDate: futureDate }));
  await expect(
    command("POST", { id: d.id, expectedVersion: 1, reason: "Future attempt" }),
  ).rejects.toMatchObject({ code: "FINANCE_FUTURE_DATE" });
});
it("atomically marks leaf, ancestor and period usage and blocks mapping changes", async () => {
  const input = body();
  input.lines[0].accountId = asset;
  const d = await command("CREATE", input);
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "First real ledger usage",
  });
  for (const id of [asset, parent]) {
    expect(
      (await db.financeAccount.findUniqueOrThrow({ where: { id } })).usedAt,
    ).not.toBeNull();
    await expect(
      db.financeAccount.update({
        where: { id },
        data: { code: `${prefix}.REMAP` },
      }),
    ).rejects.toThrow();
  }
  await expect(
    db.financePeriod.update({
      where: { id: period.id },
      data: { endDate: new Date("1800-01-01") },
    }),
  ).rejects.toThrow();
});
it("rejects raw posted header/line and source mutations or deletion", async () => {
  const d = await command("CREATE", body());
  const post = await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Retained history",
  });
  const line = await db.financeJournalLine.findFirstOrThrow({
    where: { journalId: post.journalId! },
  });
  for (const run of [
    () =>
      db.financeJournalEntry.update({
        where: { id: post.journalId! },
        data: { description: "Rewrite" },
      }),
    () => db.financeJournalEntry.delete({ where: { id: post.journalId! } }),
    () =>
      db.financeJournalLine.update({
        where: { id: line.id },
        data: { debit: "1" },
      }),
    () => db.financeJournalLine.delete({ where: { id: line.id } }),
    () =>
      db.financeJournalDraft.update({
        where: { id: d.id },
        data: { description: "Rewrite", version: 3 },
      }),
    () => db.financeJournalDraftLine.deleteMany({ where: { draftId: d.id } }),
  ])
    await expect(run()).rejects.toThrow();
});
it("rejects an unbalanced direct SQL journal at commit and restores source state", async () => {
  const d = await command("CREATE", body());
  await expect(
    db.$transaction(async (tx) => {
      const entry = await tx.financeJournalEntry.create({
        data: {
          reference: `RAW-${crypto.randomUUID()}`,
          sourceType: "JOURNAL_DRAFT",
          sourceId: d.id,
          sourceAction: "POST",
          draftId: d.id,
          postingDate: new Date(period.start),
          periodId: period.id,
          description: "Synthetic accrual adjustment",
          evidence: "Fixture evidence reference; no real receipt",
          postedById: people.owner.id,
        },
      });
      await tx.financeJournalLine.createMany({
        data: [
          {
            journalId: entry.id,
            sequence: 1,
            accountId: expense,
            description: "Dr",
            debit: "10",
            credit: "0",
          },
          {
            journalId: entry.id,
            sequence: 2,
            accountId: liability,
            description: "Cr",
            debit: "0",
            credit: "9",
          },
        ],
      });
      await tx.financeJournalDraft.update({
        where: { id: d.id },
        data: { state: "POSTED", version: 2 },
      });
    }),
  ).rejects.toThrow();
  expect((await journalDetail(people.owner, d.id)).item.state).toBe("DRAFT");
});
it("does not allow balanced append-only tampering to an existing journal", async () => {
  const d = await command("CREATE", body());
  const p = await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Append guard fixture",
  });
  await expect(
    db.$transaction(async (tx) => {
      await tx.financeJournalLine.createMany({
        data: [
          {
            journalId: p.journalId!,
            sequence: 3,
            accountId: expense,
            description: "Injected",
            debit: "1",
            credit: "0",
          },
          {
            journalId: p.journalId!,
            sequence: 4,
            accountId: liability,
            description: "Injected",
            debit: "0",
            credit: "1",
          },
        ],
      });
    }),
  ).rejects.toThrow();
});
it("replays concurrent same-key requests exactly once with private permanent receipts", async () => {
  const input = body(),
    key = crypto.randomUUID();
  const [a, b] = await Promise.all([
    command("CREATE", input, key),
    command("CREATE", input, key),
  ]);
  expect(a).toEqual(b);
  const postKey = crypto.randomUUID(),
    postBody = {
      id: a.id,
      expectedVersion: 1,
      reason: "Duplicate network retry",
    };
  const results = await Promise.all([
    command("POST", postBody, postKey),
    command("POST", postBody, postKey),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.financeJournalEntry.count({ where: { draftId: a.id } })).toBe(
    1,
  );
  expect(
    await db.financeLedgerReceipt.count({
      where: { actorId: people.owner.id, key: postKey },
    }),
  ).toBe(1);
  await expect(
    command("POST", { ...postBody, reason: "Changed payload" }, postKey),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  expect(
    JSON.stringify(
      await db.financeLedgerReceipt.findFirst({ where: { key: postKey } }),
    ),
  ).not.toContain(password);
});
it("allows only one competing posting with different request keys", async () => {
  const d = await command("CREATE", body());
  const outcomes = await Promise.allSettled([
    command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Competing post A",
    }),
    command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Competing post B",
    }),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(await db.financeJournalEntry.count({ where: { draftId: d.id } })).toBe(
    1,
  );
});
it("uses draft versions for updates and denies stale edit/post/void", async () => {
  const input = body(),
    d = await command("CREATE", input);
  await command("UPDATE", {
    ...input,
    id: d.id,
    expectedVersion: 1,
    description: "Corrected draft",
  });
  for (const action of ["POST", "VOID"] as const)
    await expect(
      command(action, {
        id: d.id,
        expectedVersion: 1,
        reason: "Stale operation",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await expect(
    command("UPDATE", { ...input, id: d.id, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
});
it("voids only drafts and preserves their lines and evidence", async () => {
  const d = await command("CREATE", body());
  await command("VOID", {
    id: d.id,
    expectedVersion: 1,
    reason: "Withdraw unposted fixture",
  });
  const view = await journalDetail(people.owner, d.id);
  expect(view.item.state).toBe("VOIDED");
  expect(view.item.lines).toHaveLength(2);
  await expect(
    command("POST", { id: d.id, expectedVersion: 2, reason: "Post withdrawn" }),
  ).rejects.toMatchObject({ code: "FINANCE_DRAFT_IMMUTABLE" });
});
it("atomically voids a versioned batch and rolls back every row on conflict", async () => {
  const a = await command("CREATE", body()),
    b = await command("CREATE", body());
  await expect(
    command("BULK_VOID", {
      items: [
        { id: a.id, expectedVersion: 1 },
        { id: b.id, expectedVersion: 2 },
      ],
      reason: "Atomic batch conflict",
    }),
  ).rejects.toMatchObject({
    code: "FINANCE_BATCH_CONFLICT",
    message: expect.stringContaining(b.id),
  });
  expect((await journalDetail(people.owner, a.id)).item.state).toBe("DRAFT");
  const voided = await command("BULK_VOID", {
    items: [
      { id: a.id, expectedVersion: 1 },
      { id: b.id, expectedVersion: 1 },
    ],
    reason: "Void both draft fixtures",
  });
  expect(voided.items).toEqual(
    [a, b]
      .sort((x, y) => (x.id < y.id ? -1 : 1))
      .map((d) => ({ id: d.id, version: 2 })),
  );
  expect((await journalDetail(people.owner, b.id)).item.state).toBe("VOIDED");
  await expect(
    command("BULK_VOID", {
      items: [
        { id: a.id, expectedVersion: 2 },
        { id: a.id, expectedVersion: 2 },
      ],
      reason: "Duplicate rows",
    }),
  ).rejects.toThrow();
});
it("creates one dated opposite reversal without rewriting original historical lines", async () => {
  const d = await command("CREATE", body());
  const posted = await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Original fixture",
  });
  const original = await db.financeJournalLine.findMany({
    where: { journalId: posted.journalId! },
    orderBy: { sequence: "asc" },
  });
  const reverseDate = new Date(new Date(period.start).getTime() + 86400000)
      .toISOString()
      .slice(0, 10),
    key = crypto.randomUUID(),
    input = {
      id: d.id,
      expectedVersion: 2,
      postingDate: reverseDate,
      reason: "Correct by dated opposite journal",
    };
  const result = await command("REVERSE", input, key);
  expect(await command("REVERSE", input, key)).toEqual(result);
  expect((await journalDetail(people.owner, d.id)).item.state).toBe("REVERSED");
  expect(
    await db.financeJournalLine.findMany({
      where: { journalId: posted.journalId! },
      orderBy: { sequence: "asc" },
    }),
  ).toEqual(original);
  const reversed = await db.financeJournalLine.findMany({
    where: { journalId: result.journalId! },
    orderBy: { sequence: "asc" },
  });
  expect(
    reversed.map((l) => [l.debit.toFixed(2), l.credit.toFixed(2)]),
  ).toEqual(original.map((l) => [l.credit.toFixed(2), l.debit.toFixed(2)]));
  await expect(command("REVERSE", input)).rejects.toMatchObject({
    code: "FINANCE_REVERSAL_INVALID",
  });
});
it("rejects backdated reversals and unavailable reversal periods", async () => {
  const d = await command("CREATE", body());
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Date reversal fixture",
  });
  const previous = new Date(new Date(period.start).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  await expect(
    command("REVERSE", {
      id: d.id,
      expectedVersion: 2,
      postingDate: previous,
      reason: "Backdated reversal",
    }),
  ).rejects.toThrow();
});
it("serializes a period-void/post race with no successful posting in a voided period", async () => {
  const p = await newPeriod(),
    d = await command("CREATE", body({ postingDate: p.start }));
  const outcomes = await Promise.allSettled([
    command("POST", { id: d.id, expectedVersion: 1, reason: "Race posting" }),
    config("PERIOD_VOID", {
      id: p.id,
      expectedVersion: 1,
      reason: "Race unused-period void",
    }),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const stored = await db.financePeriod.findUniqueOrThrow({
    where: { id: p.id },
  });
  const entries = await db.financeJournalEntry.count({
    where: { draftId: d.id },
  });
  expect(stored.state === "VOID" ? entries === 0 : entries === 1).toBe(true);
});
it("rechecks current session and access after fresh provider verification", async () => {
  const v = await proof("selected");
  await db.session.deleteMany({
    where: { userId: people.selected.authUserId! },
  });
  await expect(
    ledgerCommand(v.actor, v.proof, "CREATE", body(), crypto.randomUUID()),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  const signed = await auth.api.signInEmail({
    body: { email: people.selected.email, password },
    asResponse: true,
  });
  cookies.selected = signed.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const settings = await db.financeSettings.findFirstOrThrow(),
    grant = await db.financeGrant.findFirstOrThrow({
      where: { userId: people.selected.id, revokedAt: null },
    });
  const owner = await proof(),
    stale = await proof("selected");
  await accessCommand(
    owner.actor,
    owner.proof,
    "REVOKE",
    {
      grantId: grant.id,
      expectedVersion: settings.version,
      grantVersion: grant.version,
      reason: "Revoke current ledger access",
    },
    crypto.randomUUID(),
  );
  await expect(
    ledgerCommand(
      stale.actor,
      stale.proof,
      "CREATE",
      body(),
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
});
it("returns filtered totals across the full register rather than the current page", async () => {
  const query = prefix + ".PAGE";
  for (let i = 0; i < 3; i++)
    await command("CREATE", body({ reference: query + i }));
  const first = await journals(people.owner, { q: query, pageSize: 2 }),
    second = await journals(people.owner, { q: query, pageSize: 2, page: 2 });
  expect(first.total).toBe(3);
  expect(first.items).toHaveLength(2);
  expect(second.items).toHaveLength(1);
  expect(first.totals).toEqual({ debit: "360000.00", credit: "360000.00" });
  await expect(journals(people.owner, { sort: "SQL" })).rejects.toThrow();
});
it("keeps runtime ledger tables read-only, denies Data API access and replays setup safely", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
    for (const role of ["encova_app", "anon", "authenticated"]) {
      await sql.query("BEGIN");
      await sql.query(`SET LOCAL ROLE ${role}`);
      await expect(
        sql.query(
          role === "encova_app"
            ? 'DELETE FROM "FinanceJournalEntry"'
            : 'SELECT * FROM "FinanceJournalLine"',
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await sql.query("ROLLBACK");
    }
    const session = await auth.api.getSession({ headers: request().headers });
    await sql.query("BEGIN");
    await sql.query("SET LOCAL ROLE encova_app");
    const result = await sql.query(
      "SELECT encova_finance_ledger_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'CREATE',$3::jsonb,$4,$5) AS result",
      [
        people.owner.id,
        session!.session.id,
        JSON.stringify(body()),
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
it("uses strict private HTTP responses and feature-off denial", async () => {
  const response = await ledgerRead(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  await db.rateLimit.deleteMany({
    where: { id: { startsWith: `finance:reauth:${people.owner.id}:` } },
  });
  expect(
    (
      await ledgerMutation(
        request("owner", { ...body(), balance: "10", reauth: { password } }),
        "CREATE",
      )
    ).status,
  ).toBe(422);
  env.FINANCE_ENABLED = false;
  try {
    expect((await ledgerRead(request())).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("F08 core fixture proves dated prepayment recognition, reversal and balanced trial subset without protected-control bypass", async () => {
  const originalPeriod = period;
  period = await newPeriod();
  try {
    const first = body({
      reference: prefix + ".CORE.PREPAY",
      lines: [
        {
          accountId: asset,
          description: "Prepayment",
          debit: "120000.00",
          credit: "0.00",
          projectId: null,
        },
        {
          accountId: liability,
          description: "Accrued payable (ordinary adjustment)",
          debit: "0.00",
          credit: "120000.00",
          projectId: null,
        },
      ],
    });
    const a = await command("CREATE", first);
    await command("POST", {
      id: a.id,
      expectedVersion: 1,
      reason: "Core fixture prepayment accrual",
    });
    const b = await command(
      "CREATE",
      body({
        reference: prefix + ".CORE.RECOGNIZE",
        lines: [
          {
            accountId: expense,
            description: "Recognize monthly expense",
            debit: "10000.00",
            credit: "0.00",
            projectId: null,
          },
          {
            accountId: asset,
            description: "Release prepayment",
            debit: "0.00",
            credit: "10000.00",
            projectId: null,
          },
        ],
      }),
    );
    await command("POST", {
      id: b.id,
      expectedVersion: 1,
      reason: "Core fixture expense recognition",
    });
    const next = new Date(new Date(period.start).getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
    await command("REVERSE", {
      id: b.id,
      expectedVersion: 2,
      postingDate: next,
      reason: "Dated recognition correction",
    });
    const snapshots = await db.$queryRaw<
      { accountId: string; amount: string }[]
    >`SELECT l."accountId",sum(l.debit-l.credit)::text AS amount FROM "FinanceJournalLine" l JOIN "FinanceJournalEntry" e ON e.id=l."journalId" WHERE e."periodId"=${period.id}::uuid AND e."postingDate"<=${period.start}::date GROUP BY l."accountId"`;
    expect(
      Object.fromEntries(snapshots.map((s) => [s.accountId, s.amount])),
    ).toEqual({
      [asset]: "110000.00",
      [expense]: "10000.00",
      [liability]: "-120000.00",
    });
    const final = await db.$queryRaw<
      { debit: string; credit: string; net: string }[]
    >`SELECT sum(l.debit)::text AS debit,sum(l.credit)::text AS credit,sum(l.debit-l.credit)::text AS net FROM "FinanceJournalLine" l JOIN "FinanceJournalEntry" e ON e.id=l."journalId" WHERE e."periodId"=${period.id}::uuid`;
    expect(final[0]).toEqual({
      debit: "140000.00",
      credit: "140000.00",
      net: "0.00",
    });
  } finally {
    period = originalPeriod;
  }
});
it("retains validated finance-only snapshots of every edited draft version", async () => {
  const input = body(),
    d = await command("CREATE", input);
  await command("UPDATE", {
    ...input,
    id: d.id,
    expectedVersion: 1,
    description: "Revised description",
  });
  const history = await db.financeAuditEvent.findMany({
    where: { entityType: "FinanceJournalDraft", entityId: d.id },
    orderBy: { createdAt: "asc" },
  });
  expect(
    (history[0].data as { snapshot: { description: string } }).snapshot
      .description,
  ).toBe(input.description);
  expect(
    (history[1].data as { snapshot: { description: string } }).snapshot
      .description,
  ).toBe("Revised description");
  expect(
    typeof (history[0].data as { lines: { debit: string }[] }).lines[0].debit,
  ).toBe("string");
  expect(JSON.stringify(history)).not.toContain(password);
});
it("bounds draft totals at commit even through the restricted runtime SQL function", async () => {
  const d = await command("CREATE", body());
  const line = await db.financeJournalDraftLine.findFirstOrThrow({
    where: { draftId: d.id },
  });
  await expect(
    db.$transaction(async (tx) => {
      await tx.financeJournalDraftLine.update({
        where: { id: line.id },
        data: { debit: "999999999999999999.99", credit: "0.00" },
      });
      await tx.financeJournalDraftLine.create({
        data: {
          draftId: d.id,
          sequence: 3,
          accountId: expense,
          description: "Overflow draft total",
          debit: "1",
          credit: "0",
        },
      });
    }),
  ).rejects.toThrow();
  expect((await journalDetail(people.owner, d.id)).totals.debit).toBe(
    "120000.00",
  );
});
it("searches and paginates parent options beyond the first 25 with register-specific eligibility", async () => {
  const { accountOptions } =
    await import("@/modules/finance/accounting/options");
  const name = prefix + " searchable group";
  for (let i = 0; i < 26; i++) await account({ name, isPosting: false });
  const first = await accountOptions(people.owner, { kind: "parent", q: name }),
    second = await accountOptions(people.owner, {
      kind: "parent",
      q: name,
      page: 2,
    });
  expect(first.total).toBe(26);
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(1);
  const cash = await accountOptions(people.owner, { kind: "cash", q: prefix });
  expect(cash.items.some((i) => i.id === control)).toBe(true);
  const ordinary = await accountOptions(people.owner, {
    kind: "journal",
    q: prefix,
  });
  expect(ordinary.items.some((i) => i.id === control || i.id === parent)).toBe(
    false,
  );
  await expect(
    accountOptions(people.hr, { kind: "parent" }),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
});
