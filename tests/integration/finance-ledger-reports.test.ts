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
  prefix = "LR33." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

const { movementCommand } = await import("@/modules/finance/treasury/service");
const { ledgerCommand } = await import("@/modules/finance/ledger/service");
const { generalLedger, trialBalance, reportAccountOptions } =
  await import("@/modules/finance/reports/service");
async function move(
  action: Parameters<typeof movementCommand>[2],
  input: unknown,
  who = "owner",
) {
  const v = await proof(who);
  return movementCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function bank() {
  const gl = await account({ controlType: "CASH" }),
    b = await master("CASH_CREATE", {
      name: prefix + " bank " + ++count,
      kind: "BANK",
      glAccountId: gl,
      maskedReference: "1234",
      reason: "Explicit synthetic report bank",
    });
  return { id: b.id, gl };
}
const plus = (day: string, n: number) =>
  new Date(new Date(day + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
const minor = (x: string) => BigInt(x.replace(".", ""));
const decimal = (n: bigint) =>
  (n < 0n ? "-" : "") +
  (n < 0n ? -n : n) / 100n +
  "." +
  String((n < 0n ? -n : n) % 100n).padStart(2, "0");
async function fixture(opening = "10.01") {
  const p = await newPeriod(),
    b = await bank(),
    from = await bank();
  async function draft(amount: string, day = p.start, out = false) {
    return move("CREATE", {
      kind: "TRANSFER",
      reference: prefix + " cash " + ++count,
      fromCashId: out ? b.id : from.id,
      toCashId: out ? from.id : b.id,
      amount,
      documentDate: day,
      postingDate: day,
      description: "Actual synthetic report cash",
      evidence: "Explicit actual cash source",
      reason: "Create actual source for posted reporting",
    });
  }
  async function post(amount: string, day = p.start, out = false) {
    const m = await draft(amount, day, out);
    return move("POST", {
      id: m.id,
      expectedVersion: m.version,
      reason: "Explicit actual cash posting",
    });
  }
  if (opening !== "0.00") await post(opening);
  return { p, b, from, draft, post };
}
const dates = (f: Awaited<ReturnType<typeof fixture>>) => ({
  from: plus(f.p.start, 1),
  to: f.p.end,
});
it("actual opening plus debit/credit movements produces exact chronological running and closing balances with source anchors", async () => {
  const f = await fixture(),
    range = dates(f);
  await f.post("4.00", range.from);
  await f.post("2.00", range.from, true);
  const d = await generalLedger(people.owner, { ...range, accountId: f.b.gl });
  expect(d).toMatchObject({
    openingBalance: "10.01",
    periodDebit: "4.00",
    periodCredit: "2.00",
    closingBalance: "12.01",
    total: 2,
  });
  let balance = 1001n;
  for (const row of d.items) {
    balance += minor(row.debit) - minor(row.credit);
    expect(row.runningBalance).toBe(decimal(balance));
    expect(row.sourceType).toBe("MOVEMENT");
    expect(row.sourceId).toMatch(/^[0-9a-f-]{36}$/);
  }
  expect(d.metadata).toMatchObject({
    currency: "PKR",
    basis: "POSTED_ACCRUAL",
    timezone: "Asia/Karachi",
    from: range.from,
    to: range.to,
  });
  expect(d.metadata.ledgerDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(d.metadata.databaseSnapshot).toBeTruthy();
});
it("running balance carries through stable second-page ordering and does not restart at the page boundary", async () => {
  const f = await fixture(),
    range = dates(f);
  for (let i = 0; i < 27; i++) await f.post("1.00", range.from);
  const one = await generalLedger(people.owner, {
      ...range,
      accountId: f.b.gl,
    }),
    two = await generalLedger(people.owner, {
      ...range,
      accountId: f.b.gl,
      page: 2,
    });
  expect(one).toMatchObject({
    total: 27,
    page: 1,
    pages: 2,
    openingBalance: "10.01",
    closingBalance: "37.01",
  });
  expect(one.items).toHaveLength(25);
  expect(one.items.at(-1)!.runningBalance).toBe("35.01");
  expect(two.items.map((l) => l.runningBalance)).toEqual(["36.01", "37.01"]);
  expect(new Set([...one.items, ...two.items].map((l) => l.id)).size).toBe(27);
  expect(one.metadata.ledgerDigest).toBe(two.metadata.ledgerDigest);
}, 30000);
it("future drafts and voided drafts do not enter the posted ledger or trial balance", async () => {
  const f = await fixture(),
    m = await f.draft("999.99", "9999-12-31");
  await move("VOID", {
    id: m.id,
    expectedVersion: m.version,
    reason: "Retain unposted future source",
  });
  await f.draft("888.88", f.p.start);
  const d = await generalLedger(people.owner, {
    from: "0001-01-01",
    to: "9999-12-31",
    accountId: f.b.gl,
  });
  expect(d).toMatchObject({
    openingBalance: "0.00",
    closingBalance: "10.01",
    total: 1,
  });
  const a = await db.financeAccount.findUniqueOrThrow({
      where: { id: f.b.gl },
    }),
    tb = await trialBalance(people.owner, {
      from: "0001-01-01",
      to: "9999-12-31",
      q: a.code,
    });
  expect(tb.items[0].closingDebit).toBe("10.01");
});
it("dated opposite reversals remain visible and affect only their actual posting range", async () => {
  const f = await fixture("0.00"),
    m = await f.post("10.01");
  await move("REVERSE", {
    id: m.id,
    expectedVersion: m.version,
    postingDate: f.p.end,
    reason: "Dated actual cash correction",
  });
  const early = await generalLedger(people.owner, {
      from: f.p.start,
      to: plus(f.p.start, 1),
      accountId: f.b.gl,
    }),
    full = await generalLedger(people.owner, {
      from: f.p.start,
      to: f.p.end,
      accountId: f.b.gl,
    });
  expect(early.closingBalance).toBe("10.01");
  expect(full).toMatchObject({
    closingBalance: "0.00",
    periodDebit: "10.01",
    periodCredit: "10.01",
    total: 2,
  });
  expect(full.items.find((l) => l.isReversal)).toMatchObject({
    sourceKind: "REVERSAL",
    originalSourceId: m.id,
    originalSourceType: "MOVEMENT",
  });
});
it("credit balances split correctly even on a debit-normal cash account", async () => {
  const f = await fixture("0.00");
  await f.post("1.01", f.p.start, true);
  const d = await generalLedger(people.owner, {
    from: f.p.start,
    to: f.p.end,
    accountId: f.b.gl,
  });
  expect(d.closingBalance).toBe("-1.01");
  const a = await db.financeAccount.findUniqueOrThrow({
      where: { id: f.b.gl },
    }),
    tb = await trialBalance(people.owner, {
      from: f.p.start,
      to: f.p.end,
      q: a.code,
    });
  expect(tb.items[0]).toMatchObject({
    closingDebit: "0.00",
    closingCredit: "1.01",
    normalSide: "DEBIT",
  });
});
it("trial balance company totals remain complete and balanced when only one account is displayed", async () => {
  const f = await fixture(),
    a = await db.financeAccount.findUniqueOrThrow({ where: { id: f.b.gl } }),
    range = dates(f);
  await f.post("2.00", range.from);
  const full = await trialBalance(people.owner, range),
    display = await trialBalance(people.owner, { ...range, q: a.code });
  expect(display.items).toHaveLength(1);
  expect(display.companyTotals).toEqual(full.companyTotals);
  expect(display.companyTotals).toMatchObject({
    openingDifference: "0.00",
    periodDifference: "0.00",
    closingDifference: "0.00",
  });
  expect(display.items[0]).toMatchObject({
    openingDebit: "10.01",
    periodDebit: "2.00",
    closingDebit: "12.01",
  });
});
it("actual ordinary credit-normal liability journal preserves debit/credit splits and source type", async () => {
  const p = await newPeriod(),
    asset = await account(),
    liability = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
    });
  let v = await proof();
  const j = await ledgerCommand(
    v.actor,
    v.proof,
    "CREATE",
    {
      reference: prefix + " liability",
      postingDate: p.start,
      description: "Reviewed ordinary accrual",
      evidence: "Synthetic actual ordinary journal",
      reason: "Review actual accrual recognition",
      lines: [
        {
          accountId: asset,
          description: "Actual ordinary asset",
          debit: "10.01",
          credit: "0.00",
        },
        {
          accountId: liability,
          description: "Actual ordinary obligation",
          debit: "0.00",
          credit: "10.01",
        },
      ],
    },
    crypto.randomUUID(),
  );
  v = await proof();
  await ledgerCommand(
    v.actor,
    v.proof,
    "POST",
    {
      id: j.id,
      expectedVersion: j.version,
      reason: "Explicit actual accrual posting",
    },
    crypto.randomUUID(),
  );
  const d = await generalLedger(people.owner, {
    from: p.start,
    to: p.end,
    accountId: liability,
  });
  expect(d).toMatchObject({
    closingBalance: "-10.01",
    periodDebit: "0.00",
    periodCredit: "10.01",
  });
  expect(d.items[0].sourceType).toBe("JOURNAL_DRAFT");
});
it("archived cash controls remain available for report history and account choices", async () => {
  const f = await fixture(),
    cash = await db.financeCashAccount.findUniqueOrThrow({
      where: { id: f.b.id },
    });
  await master("CASH_ARCHIVE", {
    id: cash.id,
    expectedVersion: cash.version,
    reason: "Archive actual mapped master while retaining history",
  });
  const a = await db.financeAccount.findUniqueOrThrow({
    where: { id: f.b.gl },
  });
  await config("ACCOUNT_ARCHIVE", {
    id: a.id,
    expectedVersion: a.version,
    reason: "Archive posting account while retaining history",
  });
  const choices = await reportAccountOptions(people.owner, { q: a.code });
  expect(choices.items[0]).toMatchObject({
    id: a.id,
    active: false,
    controlType: "CASH",
  });
  expect(choices.items[0].name).toContain("(archived)");
  expect(
    (
      await generalLedger(people.owner, {
        from: f.p.start,
        to: f.p.end,
        accountId: a.id,
      })
    ).closingBalance,
  ).toBe("10.01");
});
it("year1 and9999 edges preserve empty-range opening carry without subtraction overflow", async () => {
  const f = await fixture(),
    all = await generalLedger(people.owner, {
      from: "0001-01-01",
      to: "9999-12-31",
      accountId: f.b.gl,
    }),
    later = await generalLedger(people.owner, {
      from: "9999-12-31",
      to: "9999-12-31",
      accountId: f.b.gl,
    });
  expect(all.openingBalance).toBe("0.00");
  expect(later).toMatchObject({
    openingBalance: "10.01",
    periodDebit: "0.00",
    periodCredit: "0.00",
    closingBalance: "10.01",
    total: 0,
  });
});
it("aggregate report balances preserve paisa beyond the individual document maximum without floating-point rounding", async () => {
  const f = await fixture("999999999999999999.99");
  await f.post("0.01", plus(f.p.start, 1));
  const d = await generalLedger(people.owner, {
    from: f.p.start,
    to: f.p.end,
    accountId: f.b.gl,
  });
  expect(d.closingBalance).toBe("1000000000000000000.00");
  expect(d.items.at(-1)!.runningBalance).toBe("1000000000000000000.00");
});
it("a report racing a posting returns a complete before/after view with consistent rows/totals", async () => {
  const f = await fixture(),
    m = await f.draft("1.00"),
    v = await proof("selected"),
    [report] = await Promise.all([
      generalLedger(people.owner, {
        from: f.p.start,
        to: f.p.end,
        accountId: f.b.gl,
      }),
      movementCommand(
        v.actor,
        v.proof,
        "POST",
        {
          id: m.id,
          expectedVersion: m.version,
          reason: "Concurrent actual posting",
        },
        crypto.randomUUID(),
      ),
    ]);
  expect(["10.01", "11.01"]).toContain(report.closingBalance);
  expect(
    decimal(
      report.items.reduce(
        (sum, l) => sum + minor(l.debit) - minor(l.credit),
        0n,
      ),
    ),
  ).toBe(report.closingBalance);
  expect(
    (await trialBalance(people.owner, { from: f.p.start, to: f.p.end }))
      .companyTotals.closingDifference,
  ).toBe("0.00");
});
it("reports are readonly, reject invalid filters/group accounts, and preserve private no-store HTTP errors", async () => {
  const f = await fixture(),
    before = [
      await db.financeJournalEntry.count(),
      await db.financeAuditEvent.count(),
      await db.financeLedgerReceipt.count(),
    ];
  await generalLedger(people.owner, {
    from: f.p.start,
    to: f.p.end,
    accountId: f.b.gl,
  });
  await trialBalance(people.owner, { from: f.p.start, to: f.p.end });
  expect([
    await db.financeJournalEntry.count(),
    await db.financeAuditEvent.count(),
    await db.financeLedgerReceipt.count(),
  ]).toEqual(before);
  await expect(
    generalLedger(people.owner, {
      from: "2026-02-30",
      to: "2026-11-01",
      accountId: f.b.gl,
    }),
  ).rejects.toThrow();
  const group = await account({ isPosting: false });
  await expect(
    generalLedger(people.owner, {
      from: f.p.start,
      to: f.p.end,
      accountId: group,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_UNAVAILABLE" });
  const { coreReportRead } = await import("@/modules/finance/reports/http"),
    r = await coreReportRead(
      new Request(
        env.APP_URL + "/api/v1/finance/reports/general-ledger?from=bad",
        { headers: { cookie: cookies.owner } },
      ),
      "GENERAL_LEDGER",
    );
  expect(r.status).toBe(422);
  expect(r.headers.get("cache-control")).toContain("no-store");
});
it("runtime/Data API cannot invoke raw report helpers and SQL checked entry rejects current unselected actors", async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"])
      expect(
        (
          await c.query(
            `SELECT has_function_privilege($1,'encova_finance_report_ledger(uuid,date,date,integer)','EXECUTE') AS raw`,
            [role],
          )
        ).rows[0].raw,
      ).toBe(false);
    await expect(
      c.query("SELECT encova_finance_report_core($1,$2,$3)", [
        people.other.id,
        "ACCOUNT_OPTIONS",
        JSON.stringify({ q: "", page: 1 }),
      ]),
    ).rejects.toMatchObject({ message: "FINANCE_FORBIDDEN" });
  } finally {
    await c.end();
  }
});
it("trial-balance and account choices return complete stable25-row display pages without truncating company totals", async () => {
  const p = await newPeriod(),
    marker = prefix + ".P";
  for (let i = 0; i < 27; i++)
    await account({
      code: marker + String(i).padStart(2, "0"),
      name: marker + " account " + i,
    });
  const input = { from: p.start, to: p.end, q: marker, includeZero: "YES" },
    one = await trialBalance(people.owner, input),
    two = await trialBalance(people.owner, { ...input, page: 2 }),
    choices = await reportAccountOptions(people.owner, { q: marker }),
    nextChoices = await reportAccountOptions(people.owner, {
      q: marker,
      page: 2,
    });
  expect(one).toMatchObject({ total: 27, page: 1, pages: 2 });
  expect(one.items).toHaveLength(25);
  expect(two.items).toHaveLength(2);
  expect(new Set([...one.items, ...two.items].map((a) => a.id)).size).toBe(27);
  expect(choices.items.map((a) => a.id)).toEqual(one.items.map((a) => a.id));
  expect(nextChoices.items).toHaveLength(2);
  expect(two.companyTotals).toEqual(one.companyTotals);
}, 25000);
it("all lower roles, unselected super admin, revoked grant and disabled flag lose report access", async () => {
  const f = await fixture(),
    input = { from: f.p.start, to: f.p.end, accountId: f.b.gl };
  for (const who of ["hr", "lead", "member", "other"])
    await expect(generalLedger(people[who], input)).rejects.toMatchObject({
      code: "FINANCE_FORBIDDEN",
    });
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  await expect(
    trialBalance(people.selected, { from: f.p.start, to: f.p.end }),
  ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  env.FINANCE_ENABLED = false;
  try {
    await expect(generalLedger(people.owner, input)).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
