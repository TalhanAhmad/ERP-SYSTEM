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
  { masterCommand } = await import("@/modules/finance/masters/service"),
  { ledgerCommand } = await import("@/modules/finance/ledger/service");
const { invoiceCommand, invoiceDetail, invoices } =
    await import("@/modules/finance/receivables/service"),
  { invoiceRead, invoiceMutation } =
    await import("@/modules/finance/receivables/http");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "I11." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Invoice-synthetic-test-only-9#";
let count = 0,
  client: string,
  ar: string,
  revenue: string,
  deferred: string,
  cash: string,
  expense: string,
  period: { id: string; start: string; end: string };
const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
});
const req = (who = "owner", body?: unknown, key = crypto.randomUUID()) =>
  new Request(env.APP_URL + "/api/v1/finance/invoices", {
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
  action: Parameters<typeof invoiceCommand>[2],
  body: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return invoiceCommand(v.actor, v.proof, action, body, key);
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
      reason: "Explicit synthetic invoice mapping",
      ...patch,
    })
  ).id;
}
const partyBody = (patch: Record<string, unknown> = {}) => ({
  name: prefix + " client " + ++count,
  legalName: prefix + " Synthetic Legal Co",
  kind: "CLIENT",
  contactEmail: "synthetic@example.test",
  phone: null,
  address: "Synthetic invoice address",
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
  if (!rows.length) throw new Error("No isolated invoice test interval");
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
        reason: "Isolated invoice test interval",
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
  recognition: "EARNED",
  revenueAccountId: revenue,
  deferredAccountId: null,
  projectId: null,
  ...patch,
});
const body = (patch: Record<string, unknown> = {}) => ({
  reference: prefix + "." + ++count,
  partyId: client,
  receivableAccountId: ar,
  projectId: null,
  invoiceDate: period.start,
  postingDate: period.start,
  dueDate: period.end,
  description: "Synthetic service invoice",
  evidence: "Fixture evidence only",
  currency: "PKR",
  lines: [line()],
  reason: "Reviewed synthetic invoice",
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
      reason: "Explicit invoice tester",
    },
  });
  ar = await account({ controlType: "RECEIVABLES" });
  revenue = await account({
    type: "INCOME",
    normalSide: "CREDIT",
    reportGroup: "REVENUE",
  });
  deferred = await account({
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "DEFERRED_REVENUE",
  });
  cash = await account({ controlType: "CASH" });
  expense = await account({
    type: "OPERATING_EXPENSE",
    reportGroup: "OPERATING_EXPENSES",
  });
  client = await party();
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
it("denies all unselected/lower roles before reads, filters or mutations", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(
      invoices(people[who], { invalid: true }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    await expect(
      invoiceDetail(people[who], crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    expect(
      (
        await invoiceMutation(
          req(who, { ...body(), reauth: { password } }),
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
});
it("posts earned revenue through one typed journal and matching dated receivable event", async () => {
  const d = await command("CREATE", body(), undefined, "selected");
  expect(d.number).toMatch(/^INV-\d{10}$/);
  const p = await command(
      "POST",
      { id: d.id, expectedVersion: 1, reason: "Post earned service" },
      undefined,
      "selected",
    ),
    view = await invoiceDetail(people.selected, d.id);
  expect(view.item).toMatchObject({
    state: "POSTED",
    version: 2,
    totalAmount: "300000.00",
    taxAmount: "0.00",
  });
  expect(view.item.entry!.id).toBe(p.journalId);
  expect(
    view.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [ar, "300000.00", "0.00"],
    [revenue, "0.00", "300000.00"],
  ]);
  expect(view.item.receivableEvents).toMatchObject([
    {
      partyId: client,
      accountId: ar,
      effectiveDate: period.start,
      amount: "300000.00",
      kind: "INVOICE",
    },
  ]);
  expect(view.deferredEvents).toHaveLength(0);
});
it("bills deferred revenue without recognizing profit and freezes future revenue mapping", async () => {
  const futureRevenue = await account({
      type: "INCOME",
      normalSide: "CREDIT",
      reportGroup: "REVENUE",
    }),
    d = await command(
      "CREATE",
      body({
        lines: [
          line({
            recognition: "DEFERRED",
            deferredAccountId: deferred,
            revenueAccountId: futureRevenue,
            unitRate: "50000.00",
          }),
        ],
      }),
    );
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Bill unearned service",
  });
  const view = await invoiceDetail(people.owner, d.id);
  expect(view.item.entry!.lines.map((l) => l.accountId)).toEqual([
    ar,
    deferred,
  ]);
  expect(view.deferredEvents).toMatchObject([
    { kind: "BILLED", amount: "50000.00", effectiveDate: period.start },
  ]);
  expect(
    (
      await db.financeAccount.findUniqueOrThrow({
        where: { id: futureRevenue },
      })
    ).usedAt,
  ).not.toBeNull();
  expect(
    await db.financeJournalLine.count({
      where: { journalId: view.item.entry!.id, accountId: futureRevenue },
    }),
  ).toBe(0);
});
it("recomputes mixed earned/deferred line rounding and discounts independently in PostgreSQL", async () => {
  const d = await command(
    "CREATE",
    body({
      lines: [
        line({ quantity: "2", unitRate: "100.005", discountAmount: "0.01" }),
        line({
          recognition: "DEFERRED",
          deferredAccountId: deferred,
          unitRate: "50.005",
          discountAmount: "0.01",
        }),
      ],
    }),
  );
  const before = await invoiceDetail(people.owner, d.id);
  expect(before.item).toMatchObject({
    lineAmount: "250.02",
    discountAmount: "0.02",
    netAmount: "250.00",
    totalAmount: "250.00",
  });
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Mixed billing fixture",
  });
  const view = await invoiceDetail(people.owner, d.id);
  expect(view.item.entry!.lines.map((l) => l.credit)).toEqual([
    "0.00",
    "200.00",
    "50.00",
  ]);
  expect(view.deferredEvents[0].amount).toBe("50.00");
});

it("retains zero-value evidence lines but emits only positive credits", async () => {
  const d = await command(
    "CREATE",
    body({
      lines: [
        line({ unitRate: "0" }),
        line({ unitRate: "10", discountAmount: "10" }),
        line({ unitRate: "0.005" }),
      ],
    }),
  );
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Positive rounding fixture",
  });
  const view = await invoiceDetail(people.owner, d.id);
  expect(view.item.lines).toHaveLength(3);
  expect(view.item.totalAmount).toBe("0.01");
  expect(view.item.entry!.lines.map((l) => l.sequence)).toEqual([1, 4]);
});
it("refuses an all-zero posting without an event, receipt, audit or usage side effect", async () => {
  const d = await command("CREATE", body({ lines: [line({ unitRate: "0" })] })),
    key = crypto.randomUUID();
  await expect(
    command(
      "POST",
      { id: d.id, expectedVersion: 1, reason: "Zero value check" },
      key,
    ),
  ).rejects.toMatchObject({ code: "FINANCE_INVOICE_EMPTY" });
  expect((await invoiceDetail(people.owner, d.id)).item).toMatchObject({
    state: "DRAFT",
    version: 1,
    entry: null,
    receivableEvents: [],
  });
  expect(await db.financeLedgerReceipt.count({ where: { key } })).toBe(0);
  expect(await db.financeAuditEvent.count({ where: { entityId: d.id } })).toBe(
    1,
  );
});
it("posts 100 individually rounded fractional lines using exact decimal strings", async () => {
  const d = await command(
    "CREATE",
    body({
      lines: Array.from({ length: 100 }, () => line({ unitRate: "0.005" })),
    }),
  );
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Maximum invoice line count",
  });
  const view = await invoiceDetail(people.owner, d.id);
  expect(view.item.totalAmount).toBe("1.00");
  expect(view.item.entry!.lines).toHaveLength(101);
});
it("updates drafts with optimistic versions and permanently reserves voided invoice numbers", async () => {
  const input = body(),
    d = await command("CREATE", input);
  const updated = await command("UPDATE", {
    ...input,
    id: d.id,
    expectedVersion: 1,
    lines: [line({ unitRate: "25" })],
  });
  expect(updated).toMatchObject({ id: d.id, number: d.number, version: 2 });
  await expect(
    command("UPDATE", { ...input, id: d.id, expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await command("VOID", {
    id: d.id,
    expectedVersion: 2,
    reason: "Unused synthetic draft",
  });
  expect((await invoiceDetail(people.owner, d.id)).item).toMatchObject({
    state: "VOIDED",
    version: 3,
    entry: null,
    totalAmount: "25.00",
  });
  await expect(
    command("POST", {
      id: d.id,
      expectedVersion: 3,
      reason: "Cannot post voided source",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVOICE_IMMUTABLE" });
  expect((await command("CREATE", body())).number).not.toBe(d.number);
});
it("freezes posted client contact evidence while current master contact remains editable", async () => {
  const input = partyBody(),
    p = (await master("PARTY_CREATE", input)).id;
  const d = await command("CREATE", body({ partyId: p }));
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Freeze commercial evidence",
  });
  const original = (await invoiceDetail(people.owner, d.id)).item.partySnapshot;
  await master("PARTY_UPDATE", {
    ...input,
    id: p,
    expectedVersion: 1,
    name: prefix + " renamed client",
    address: "Changed current address",
  });
  const view = await invoiceDetail(people.owner, d.id);
  expect(view.item.partySnapshot).toEqual(original);
  expect(view.item.party.name).toBe(prefix + " renamed client");
  expect(original).toMatchObject({
    name: input.name,
    address: input.address,
    schemaVersion: 1,
  });
});
it("replays concurrent create/post keys once and rejects changed request payloads", async () => {
  const input = body(),
    key = crypto.randomUUID();
  const [a, b] = await Promise.all([
    command("CREATE", input, key),
    command("CREATE", input, key),
  ]);
  expect(a).toEqual(b);
  await expect(
    command("CREATE", { ...input, description: "Changed content" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  const post = { id: a.id, expectedVersion: 1, reason: "Concurrent posting" },
    pk = crypto.randomUUID();
  const [p, q] = await Promise.all([
    command("POST", post, pk),
    command("POST", post, pk),
  ]);
  expect(p).toEqual(q);
  expect(
    await db.financeJournalEntry.count({ where: { invoiceId: a.id } }),
  ).toBe(1);
  expect(
    await db.financeReceivableEvent.count({ where: { invoiceId: a.id } }),
  ).toBe(1);
  expect(await db.financeAuditEvent.count({ where: { entityId: a.id } })).toBe(
    2,
  );
});
it("serializes competing post keys and edit/post races to one committed version", async () => {
  for (const race of ["post", "edit"]) {
    const input = body(),
      d = await command("CREATE", input);
    const results = await Promise.allSettled([
      command("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Concurrent post first",
      }),
      race === "post"
        ? command("POST", {
            id: d.id,
            expectedVersion: 1,
            reason: "Concurrent post second",
          })
        : command("UPDATE", {
            ...input,
            id: d.id,
            expectedVersion: 1,
            description: "Concurrent draft edit",
          }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await invoiceDetail(people.owner, d.id)).item.version).toBe(2);
  }
});
it("refuses inactive/supplier clients on create and rechecks archived clients on post", async () => {
  const supplier = await party({ kind: "SUPPLIER" });
  await expect(
    command("CREATE", body({ partyId: supplier })),
  ).rejects.toMatchObject({ code: "FINANCE_INVOICE_PARTY" });
  const p = await party(),
    d = await command("CREATE", body({ partyId: p }));
  await master("PARTY_ARCHIVE", {
    id: p,
    expectedVersion: 1,
    reason: "Archive synthetic client",
  });
  await expect(
    command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Archived client check",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVOICE_PARTY" });
  await expect(command("CREATE", body({ partyId: p }))).rejects.toMatchObject({
    code: "FINANCE_INVOICE_PARTY",
  });
});
it("rejects inappropriate AR, income and deferred mappings atomically", async () => {
  for (const patch of [
    { receivableAccountId: cash },
    { lines: [line({ revenueAccountId: expense })] },
    { lines: [line({ recognition: "DEFERRED", deferredAccountId: ar })] },
  ]) {
    const d = await command("CREATE", body(patch));
    await expect(
      command("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Invalid mapping check",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_INVOICE_MAPPING" });
    expect((await invoiceDetail(people.owner, d.id)).item).toMatchObject({
      state: "DRAFT",
      entry: null,
      receivableEvents: [],
    });
  }
});
it("blocks direct manual journals into receivables and deferred-revenue controls", async () => {
  for (const control of [ar, deferred]) {
    const v = await proof(),
      d = await ledgerCommand(
        v.actor,
        v.proof,
        "CREATE",
        {
          reference: prefix + ".BYPASS." + control,
          description: "Forbidden bypass",
          evidence: "Synthetic bypass check",
          postingDate: period.start,
          currency: "PKR",
          reason: "Protected source check",
          lines: [
            {
              accountId: control,
              description: "Protected",
              debit: "5.00",
              credit: "0.00",
              projectId: null,
            },
            {
              accountId: revenue,
              description: "Counterpart",
              debit: "0.00",
              credit: "5.00",
              projectId: null,
            },
          ],
        },
        crypto.randomUUID(),
      );
    const verified = await proof();
    await expect(
      ledgerCommand(
        verified.actor,
        verified.proof,
        "POST",
        { id: d.id, expectedVersion: 1, reason: "Attempt generic bypass" },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FINANCE_CONTROL_PROTECTED" });
  }
});
it("refuses future/closed posting dates and rolls back all invoice side effects", async () => {
  const future = await newPeriod(true),
    closed = await newPeriod();
  await config("PERIOD_VOID", {
    id: closed.id,
    expectedVersion: 1,
    reason: "Void unused fixture period",
  });
  for (const [p, code] of [
    [future, "FINANCE_FUTURE_DATE"],
    [closed, "FINANCE_PERIOD_UNAVAILABLE"],
  ] as const) {
    const d = await command(
      "CREATE",
      body({ invoiceDate: p.start, postingDate: p.start, dueDate: p.end }),
    );
    await expect(
      command("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Unavailable posting date",
      }),
    ).rejects.toMatchObject({ code });
    expect((await invoiceDetail(people.owner, d.id)).item.entry).toBeNull();
  }
});
it("rejects posted source edits, voids, direct deletes and immutable event tampering", async () => {
  const input = body({
      lines: [line({ recognition: "DEFERRED", deferredAccountId: deferred })],
    }),
    d = await command("CREATE", input);
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Immutable source fixture",
  });
  for (const action of ["UPDATE", "VOID"] as const)
    await expect(
      command(action, {
        ...(action === "UPDATE" ? input : {}),
        id: d.id,
        expectedVersion: 2,
        reason: "Cannot alter posted evidence",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_INVOICE_IMMUTABLE" });
  await expect(
    db.financeInvoice.delete({ where: { id: d.id } }),
  ).rejects.toThrow();
  await expect(
    db.financeInvoiceLine.updateMany({
      where: { invoiceId: d.id },
      data: { description: "Tampered" },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeReceivableEvent.updateMany({
      where: { invoiceId: d.id },
      data: { amount: "1" },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeDeferredRevenueEvent.deleteMany({
      where: { invoiceLine: { invoiceId: d.id } },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeJournalEntry.updateMany({
      where: { invoiceId: d.id },
      data: { description: "Tampered" },
    }),
  ).rejects.toThrow();
});
it("paginates a full filtered invoice register with string totals independent of page size", async () => {
  const tag = prefix + ".FILTER";
  for (const amount of ["1.01", "2.02", "3.03"])
    await command(
      "CREATE",
      body({ reference: tag, lines: [line({ unitRate: amount })] }),
    );
  const first = await invoices(people.selected, {
      q: tag,
      pageSize: 1,
      sort: "number",
    }),
    last = await invoices(people.selected, {
      q: tag,
      pageSize: 1,
      page: 999,
      sort: "number",
    });
  expect(first).toMatchObject({
    total: 3,
    pages: 3,
    page: 1,
    totals: { totalAmount: "6.06", taxAmount: "0.00" },
  });
  expect(last).toMatchObject({ total: 3, page: 3, totals: first.totals });
  expect(first.items[0].id).not.toBe(last.items[0].id);
  await expect(
    invoices(people.owner, { includePrivate: true }),
  ).rejects.toThrow();
});
it("keeps unauthenticated, feature-off, invalid and CSRF responses private", async () => {
  const anonymous = await invoiceRead(req("anonymous"));
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("cache-control")).toContain("no-store");
  const invalid = await invoiceRead(
    new Request(env.APP_URL + "/api/v1/finance/invoices?includePrivate=true", {
      headers: { cookie: cookies.owner },
    }),
  );
  expect(invalid.status).toBe(422);
  const csrf = await invoiceMutation(
    new Request(env.APP_URL + "/api/v1/finance/invoices", {
      method: "POST",
      headers: { origin: "https://wrong.example.test" },
      body: "{}",
    }),
    "CREATE",
  );
  expect(csrf.status).toBe(403);
  env.FINANCE_ENABLED = false;
  try {
    expect((await invoiceRead(req())).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("rechecks revoked access even when an invoice reauthentication proof already exists", async () => {
  const verified = await proof("selected");
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  try {
    await expect(
      invoiceCommand(
        verified.actor,
        verified.proof,
        "CREATE",
        body(),
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
  } finally {
    await db.financeGrant.updateMany({
      where: { userId: people.selected.id },
      data: { revokedAt: null, revokedById: null },
    });
  }
});
it("limits runtime database access to checked commands and reads, including after setup replay", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
    await sql.query("SET ROLE encova_app");
    const rights = await sql.query(
      `SELECT has_table_privilege(current_user,'"FinanceInvoice"','SELECT') AS read,has_table_privilege(current_user,'"FinanceInvoice"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_invoice_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_emit_journal(uuid,text,uuid,date,text)','EXECUTE') AS emit,has_sequence_privilege(current_user,'finance_invoice_number','USAGE') AS number`,
    );
    expect(rights.rows[0]).toEqual({
      read: true,
      write: false,
      command: true,
      emit: false,
      number: false,
    });
    for (const stmt of [
      `SELECT encova_finance_party_snapshot('${client}')`,
      `SELECT encova_finance_emit_journal('${people.owner.id}','INVOICE','${crypto.randomUUID()}',DATE '${period.start}','Bypass')`,
      `SELECT nextval('finance_invoice_number')`,
      `DELETE FROM "FinanceInvoice"`,
    ])
      await expect(sql.query(stmt)).rejects.toMatchObject({ code: "42501" });
    await sql.query("RESET ROLE");
    for (const role of ["anon", "authenticated"]) {
      await sql.query("SET ROLE " + role);
      await expect(
        sql.query('SELECT * FROM "FinanceInvoice"'),
      ).rejects.toMatchObject({ code: "42501" });
      const r = await sql.query(
        "SELECT has_function_privilege(current_user,'encova_finance_invoice_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command",
      );
      expect(r.rows[0].command).toBe(false);
      await sql.query("RESET ROLE");
    }
  } finally {
    await sql.end();
  }
});
it("inherits header projects, allows explicit line projects and rechecks archival on posting", async () => {
  const projects = await Promise.all(
    ["header", "line"].map((name) =>
      db.project.create({
        data: {
          name: prefix + " " + name,
          description: "Synthetic invoice project",
          managerId: people.owner.id,
        },
      }),
    ),
  );
  const d = await command(
    "CREATE",
    body({
      projectId: projects[0].id,
      lines: [line(), line({ projectId: projects[1].id })],
    }),
  );
  expect(
    (await invoiceDetail(people.owner, d.id)).item.lines.map(
      (l) => l.projectId,
    ),
  ).toEqual(projects.map((p) => p.id));
  await db.project.update({
    where: { id: projects[1].id },
    data: { archivedAt: new Date() },
  });
  await expect(
    command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Recheck archived dimension",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_PROJECT_UNAVAILABLE" });
});
it("serializes period void against posting without a stranded invoice journal", async () => {
  const p = await newPeriod(),
    d = await command(
      "CREATE",
      body({ invoiceDate: p.start, postingDate: p.start, dueDate: p.end }),
    );
  const results = await Promise.allSettled([
    command("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Concurrent invoice posting",
    }),
    config("PERIOD_VOID", {
      id: p.id,
      expectedVersion: 1,
      reason: "Concurrent unused period void",
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const source = await invoiceDetail(people.owner, d.id),
    stored = await db.financePeriod.findUniqueOrThrow({ where: { id: p.id } });
  expect(
    source.item.state === "POSTED"
      ? stored.state === "OPEN"
      : stored.state === "VOID",
  ).toBe(true);
});
it("rolls back even balanced raw invoice journals when the dated receivable event is missing", async () => {
  const d = await command("CREATE", body()),
    journalId = crypto.randomUUID();
  await expect(
    db.$transaction(async (tx) => {
      const i = await tx.financeInvoice.findUniqueOrThrow({
        where: { id: d.id },
        include: { lines: true },
      });
      await tx.financeJournalEntry.create({
        data: {
          id: journalId,
          reference: "JRN-" + journalId,
          sourceType: "INVOICE",
          sourceId: d.id,
          sourceAction: "POST",
          invoiceId: d.id,
          postingDate: i.postingDate,
          periodId: period.id,
          description: i.description,
          evidence: i.evidence,
          postedById: people.owner.id,
        },
      });
      await tx.financeJournalLine.create({
        data: {
          journalId,
          sequence: 1,
          accountId: ar,
          description: i.description,
          debit: i.totalAmount,
          credit: "0",
          partyId: client,
        },
      });
      await tx.financeJournalLine.create({
        data: {
          journalId,
          sequence: 2,
          accountId: revenue,
          description: i.lines[0].description,
          debit: "0",
          credit: i.totalAmount,
          partyId: client,
          invoiceLineId: i.lines[0].id,
        },
      });
      await tx.$executeRaw`UPDATE "FinanceInvoice" SET state='POSTED',version=2,"partySnapshot"=encova_finance_party_snapshot("partyId") WHERE id=${d.id}::uuid`;
    }),
  ).rejects.toThrow();
  expect((await invoiceDetail(people.owner, d.id)).item).toMatchObject({
    state: "DRAFT",
    version: 1,
    entry: null,
    partySnapshot: null,
  });
  expect(await db.financeJournalEntry.count({ where: { id: journalId } })).toBe(
    0,
  );
});
it("posts through the real restricted runtime command with dated AR and no cash movement", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    const session = await db.session.findFirstOrThrow({
      where: { userId: people.owner.authUserId! },
      orderBy: { createdAt: "desc" },
    });
    await sql.query("SET ROLE encova_app");
    const run = async (action: string, input: unknown) =>
      (
        await sql.query(
          "SELECT encova_finance_invoice_command($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4::jsonb,$5,$6) AS result",
          [
            people.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].result;
    const d = await run(
      "CREATE",
      body({
        lines: [
          line({
            recognition: "DEFERRED",
            deferredAccountId: deferred,
            unitRate: "12.34",
          }),
        ],
      }),
    );
    await run("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Restricted runtime invoice posting",
    });
    const amounts = await sql.query(
      `SELECT e."postingDate"::text AS date,sum(l.debit)::text AS debit,sum(l.credit)::text AS credit,count(*) FILTER(WHERE a."controlType"='CASH')::int AS cash FROM "FinanceJournalEntry" e JOIN "FinanceJournalLine" l ON l."journalId"=e.id JOIN "FinanceAccount" a ON a.id=l."accountId" WHERE e."invoiceId"=$1 GROUP BY e."postingDate"`,
      [d.id],
    );
    expect(amounts.rows).toEqual([
      { date: period.start, debit: "12.34", credit: "12.34", cash: 0 },
    ]);
  } finally {
    await sql.end();
  }
});
