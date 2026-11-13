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

const { invoiceCommand, invoiceDetail } =
  await import("@/modules/finance/receivables/service");
const { customerCommand, customerDetail, customers } =
  await import("@/modules/finance/receivables/customer/service");
const { customerRead, customerMutation } =
  await import("@/modules/finance/receivables/customer/http");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "I13." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Invoice-synthetic-test-only-9#";
let count = 0,
  client: string,
  ar: string,
  revenue: string,
  cash: string,
  expense: string,
  bank: string,
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
  cash = await account({ controlType: "CASH" });
  expense = await account({
    type: "OPERATING_EXPENSE",
    reportGroup: "OPERATING_EXPENSES",
  });
  bank = (
    await master("CASH_CREATE", {
      name: prefix + " Bank",
      kind: "BANK",
      glAccountId: cash,
      currency: "PKR",
      maskedReference: "1234",
      reason: "Synthetic receipt bank",
    })
  ).id;
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
async function invoice(
  amount = "300000.00",
  patch: Record<string, unknown> = {},
) {
  const d = await command(
    "CREATE",
    body({ ...patch, lines: [line({ unitRate: amount })] }),
  );
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Synthetic billed service",
  });
  return d;
}
const receipt = (
  allocations: { invoiceId: string; amount: string }[],
  cashAmount: string,
  patch: Record<string, unknown> = {},
) => ({
  reference: prefix + ".R" + ++count,
  partyId: client,
  cashAccountId: bank,
  feeAccountId: null,
  projectId: null,
  documentDate: period.start,
  postingDate: period.start,
  description: "Synthetic cash receipt",
  evidence: "Synthetic bank evidence",
  currency: "PKR",
  cashAmount,
  feeAmount: "0.00",
  allocations,
  reason: "Reviewed receipt evidence",
  ...patch,
});
async function customer(
  action: Parameters<typeof customerCommand>[3],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return customerCommand(v.actor, v.proof, "RECEIPT", action, input, key);
}
async function postReceipt(input: unknown) {
  const d = await customer("CREATE", input);
  await customer("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Record actual cash received",
  });
  return customerDetail(people.owner, "RECEIPT", d.id);
}
const outstanding = async (id: string) =>
  (
    await db.financeReceivableEvent.aggregate({
      where: { invoiceId: id },
      _sum: { amount: true },
    })
  )._sum.amount!.toFixed(2);
it("records a partial receipt without recognizing revenue a second time", async () => {
  const i = await invoice(),
    r = await postReceipt(
      receipt([{ invoiceId: i.id, amount: "200000.00" }], "200000.00"),
    );
  expect(await outstanding(i.id)).toBe("100000.00");
  expect(
    r.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [cash, "200000.00", "0.00"],
    [ar, "0.00", "200000.00"],
  ]);
  expect(r.item.receivableEvents[0]).toMatchObject({
    kind: "RECEIPT",
    amount: "-200000.00",
    effectiveDate: period.start,
  });
  expect((await invoiceDetail(people.owner, i.id)).item.totalAmount).toBe(
    "300000.00",
  );
});
it("settles multiple invoices with explicit fees and permits multiple receipts on one invoice", async () => {
  const a = await invoice("6000"),
    b = await invoice("6000");
  const r = await postReceipt(
    receipt(
      [
        { invoiceId: a.id, amount: "6000" },
        { invoiceId: b.id, amount: "4000" },
      ],
      "9800",
      { feeAmount: "200", feeAccountId: expense },
    ),
  );
  expect(r.item.entry!.lines.map((l) => [l.debit, l.credit])).toEqual([
    ["9800.00", "0.00"],
    ["200.00", "0.00"],
    ["0.00", "6000.00"],
    ["0.00", "4000.00"],
  ]);
  await postReceipt(receipt([{ invoiceId: b.id, amount: "2000" }], "2000"));
  expect(await outstanding(a.id)).toBe("0.00");
  expect(await outstanding(b.id)).toBe("0.00");
});
it("replays uncertain concurrent requests once and rejects changed payloads", async () => {
  const i = await invoice("10"),
    input = receipt([{ invoiceId: i.id, amount: "10" }], "10"),
    key = crypto.randomUUID();
  const [a, b] = await Promise.all([
    customer("CREATE", input, key),
    customer("CREATE", input, key),
  ]);
  expect(a).toEqual(b);
  await expect(
    customer("CREATE", { ...input, description: "Changed" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  const post = { id: a.id, expectedVersion: 1, reason: "One receipt posting" },
    pk = crypto.randomUUID();
  expect(await customer("POST", post, pk)).toEqual(
    await customer("POST", post, pk),
  );
  expect(await outstanding(i.id)).toBe("0.00");
});
it("serializes concurrent overallocations to one success with no negative balance", async () => {
  const i = await invoice("100"),
    a = await customer(
      "CREATE",
      receipt([{ invoiceId: i.id, amount: "60" }], "60"),
    ),
    b = await customer(
      "CREATE",
      receipt([{ invoiceId: i.id, amount: "60" }], "60"),
    );
  const r = await Promise.allSettled(
    [a, b].map((d) =>
      customer("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Concurrent settlement",
      }),
    ),
  );
  expect(r.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  expect(await outstanding(i.id)).toBe("40.00");
});
it("reserves future-dated settlements when checking backdated receipt capacity", async () => {
  const i = await invoice("100"),
    day = (n: number) =>
      new Date(new Date(period.start).getTime() + n * 86400000)
        .toISOString()
        .slice(0, 10);
  await postReceipt(
    receipt([{ invoiceId: i.id, amount: "40" }], "40", { postingDate: day(5) }),
  );
  const d = await customer(
    "CREATE",
    receipt([{ invoiceId: i.id, amount: "80" }], "80", { postingDate: day(1) }),
  );
  await expect(
    customer("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Backdated over-allocation",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ALLOCATION_UNAVAILABLE" });
  expect(await outstanding(i.id)).toBe("60.00");
});
it("rejects cross-client and not-yet-effective invoice settlements atomically", async () => {
  const other = await party(),
    i = await invoice("100", { partyId: other }),
    future = await invoice("100", { postingDate: period.end });
  for (const target of [i, future]) {
    const d = await customer(
      "CREATE",
      receipt([{ invoiceId: target.id, amount: "10" }], "10"),
    );
    await expect(
      customer("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Check eligible invoice",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_ALLOCATION_UNAVAILABLE" });
    expect(
      (await customerDetail(people.owner, "RECEIPT", d.id)).item.entry,
    ).toBeNull();
  }
});
it("rejects wrong fee mappings and rechecks archived cash mappings", async () => {
  const i = await invoice("100"),
    d = await customer(
      "CREATE",
      receipt([{ invoiceId: i.id, amount: "10" }], "9", {
        feeAmount: "1",
        feeAccountId: revenue,
      }),
    );
  await expect(
    customer("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Fee must be an expense",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CUSTOMER_MAPPING" });
  const cashGl = await account({ controlType: "CASH" }),
    b = (
      await master("CASH_CREATE", {
        name: prefix + " archived bank",
        kind: "BANK",
        glAccountId: cashGl,
        currency: "PKR",
        reason: "Synthetic bank",
      })
    ).id,
    r = await customer(
      "CREATE",
      receipt([{ invoiceId: i.id, amount: "10" }], "10", { cashAccountId: b }),
    );
  await master("CASH_ARCHIVE", {
    id: b,
    expectedVersion: 1,
    reason: "Archive unused receipt bank",
  });
  await expect(
    customer("POST", {
      id: r.id,
      expectedVersion: 1,
      reason: "Archived cash check",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CUSTOMER_MAPPING" });
});
it("retains draft versions/voided numbers and rejects posted source/allocation mutation", async () => {
  const i = await invoice("100"),
    input = receipt([{ invoiceId: i.id, amount: "10" }], "10"),
    d = await customer("CREATE", input);
  await customer("UPDATE", {
    ...input,
    id: d.id,
    expectedVersion: 1,
    description: "Corrected draft",
  });
  await expect(
    customer("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Stale draft check",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await customer("VOID", {
    id: d.id,
    expectedVersion: 2,
    reason: "Withdraw unposted receipt",
  });
  const next = await postReceipt(input);
  expect(next.item.number).not.toBe(d.number);
  await expect(
    db.financeCustomerAllocation.updateMany({
      where: { documentId: next.item.id },
      data: { amount: "1" },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeCustomerDocument.delete({ where: { id: next.item.id } }),
  ).rejects.toThrow();
});
it("allows settling a retained invoice after its operational project is archived", async () => {
  const p = await db.project.create({
      data: {
        name: prefix + " retained project",
        description: "Synthetic project",
        managerId: people.owner.id,
      },
    }),
    i = await invoice("100", { projectId: p.id });
  await db.project.update({
    where: { id: p.id },
    data: { archivedAt: new Date() },
  });
  await postReceipt(
    receipt([{ invoiceId: i.id, amount: "10" }], "10", { projectId: p.id }),
  );
  expect(await outstanding(i.id)).toBe("90.00");
});
it("denies unselected roles and preserves private feature-off/validation responses", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(
      customers(people[who], "RECEIPT", { bad: true }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    expect(
      (
        await customerMutation(
          req(who, { reauth: { password } }),
          "RECEIPT",
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
  const response = await customerRead(req("anonymous"), "RECEIPT");
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toContain("no-store");
  env.FINANCE_ENABLED = false;
  try {
    expect((await customerRead(req(), "RECEIPT")).status).toBe(404);
  } finally {
    env.FINANCE_ENABLED = true;
  }
});
it("returns full-filter receipt totals independent of page size", async () => {
  const i = await invoice("100"),
    reference = prefix + " filter";
  for (const cashAmount of ["1", "2", "3"])
    await customer(
      "CREATE",
      receipt([{ invoiceId: i.id, amount: cashAmount }], cashAmount, {
        reference,
      }),
    );
  const a = await customers(people.selected, "RECEIPT", {
    q: reference,
    pageSize: 1,
  });
  expect(a).toMatchObject({
    total: 3,
    pages: 3,
    totals: { cashAmount: "6.00", allocationAmount: "6.00" },
  });
});
it("refuses a balanced raw receipt journal if its dated receivable event is absent", async () => {
  const i = await invoice("10"),
    d = await customer(
      "CREATE",
      receipt([{ invoiceId: i.id, amount: "10" }], "10"),
    ),
    entry = crypto.randomUUID();
  await expect(
    db.$transaction(async (tx) => {
      const source = await tx.financeCustomerDocument.findUniqueOrThrow({
        where: { id: d.id },
      });
      await tx.financeJournalEntry.create({
        data: {
          id: entry,
          reference: "JRN-" + entry,
          sourceType: "CUSTOMER_DOCUMENT",
          sourceId: d.id,
          sourceAction: "POST",
          customerDocumentId: d.id,
          postingDate: source.postingDate,
          periodId: period.id,
          description: source.description,
          evidence: source.evidence,
          postedById: people.owner.id,
        },
      });
      await tx.$executeRaw`INSERT INTO "FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),${entry}::uuid,x.* FROM encova_finance_customer_lines(${d.id}::uuid)x`;
      await tx.$executeRaw`UPDATE "FinanceCustomerDocument" SET state='POSTED',version=2,"partySnapshot"=encova_finance_party_snapshot("partyId") WHERE id=${d.id}::uuid`;
    }),
  ).rejects.toThrow();
  expect((await customerDetail(people.owner, "RECEIPT", d.id)).item.state).toBe(
    "DRAFT",
  );
  expect(await db.financeJournalEntry.count({ where: { id: entry } })).toBe(0);
});
it("executes the checked receipt adapter under encova_app while helper/table/sequence writes stay private", async () => {
  const i = await invoice("10"),
    sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
    const s = await db.session.findFirstOrThrow({
      where: { userId: people.owner.authUserId! },
      orderBy: { createdAt: "desc" },
    });
    await sql.query("SET ROLE encova_app");
    const run = async (action: string, input: unknown) =>
      (
        await sql.query(
          "SELECT encova_finance_customer_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'RECEIPT',$3,$4::jsonb,$5,$6) AS result",
          [
            people.owner.id,
            s.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].result;
    const d = await run(
      "CREATE",
      receipt([{ invoiceId: i.id, amount: "10.00" }], "10.00"),
    );
    await run("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Restricted runtime receipt",
    });
    expect(
      (
        await sql.query(
          'SELECT state FROM "FinanceCustomerDocument" WHERE id=$1',
          [d.id],
        )
      ).rows[0].state,
    ).toBe("POSTED");
    for (const stmt of [
      'DELETE FROM "FinanceCustomerDocument"',
      "SELECT nextval('finance_customer_number')",
      `SELECT encova_finance_customer_lines('${d.id}')`,
    ])
      await expect(sql.query(stmt)).rejects.toMatchObject({ code: "42501" });
  } finally {
    await sql.end();
  }
});
async function advanceAccount() {
  return account({
    type: "LIABILITY",
    normalSide: "CREDIT",
    reportGroup: "CURRENT_LIABILITIES",
    controlType: "CLIENT_ADVANCE",
  });
}
async function application(
  action: Parameters<typeof customerCommand>[3],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return customerCommand(
    v.actor,
    v.proof,
    "ADVANCE_APPLICATION",
    action,
    input,
    key,
  );
}
const applicationBody = (
  sourceDocumentId: string,
  allocations: { invoiceId: string; amount: string }[],
  patch: Record<string, unknown> = {},
) => ({
  reference: prefix + ".AAP" + ++count,
  partyId: client,
  sourceDocumentId,
  projectId: null,
  documentDate: period.start,
  postingDate: period.start,
  description: "Apply held client advance",
  evidence: "Synthetic allocation authorization",
  currency: "PKR",
  allocations,
  reason: "Reviewed advance application",
  ...patch,
});
it("holds an unallocated advance as liability and applies it later without a second cash movement", async () => {
  const liability = await advanceAccount(),
    r = await postReceipt(
      receipt([], "50000", { advanceAccountId: liability }),
    ),
    i = await invoice("300000"),
    a = await application(
      "CREATE",
      applicationBody(r.item.id, [{ invoiceId: i.id, amount: "20000" }]),
    );
  await application("POST", {
    id: a.id,
    expectedVersion: 1,
    reason: "Apply part of held money",
  });
  const v = await customerDetail(people.selected, "ADVANCE_APPLICATION", a.id);
  expect(
    v.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [liability, "20000.00", "0.00"],
    [ar, "0.00", "20000.00"],
  ]);
  expect(v.availableAdvance).toBe("30000.00");
  expect(await outstanding(i.id)).toBe("280000.00");
  expect(
    (await customerDetail(people.owner, "RECEIPT", r.item.id)).item
      .advanceAmount,
  ).toBe("50000.00");
});
it("splits a mixed receipt into invoice settlement and client advance exactly once", async () => {
  const liability = await advanceAccount(),
    i = await invoice("100"),
    r = await postReceipt(
      receipt([{ invoiceId: i.id, amount: "60" }], "100", {
        advanceAccountId: liability,
      }),
    );
  expect(r.item).toMatchObject({
    cashAmount: "100.00",
    allocationAmount: "60.00",
    advanceAmount: "40.00",
    totalAmount: "100.00",
  });
  expect(r.availableAdvance).toBe("40.00");
  expect(await outstanding(i.id)).toBe("40.00");
  expect(r.item.entry!.lines.map((l) => l.accountId)).toEqual([
    cash,
    ar,
    liability,
  ]);
});
it("prevents concurrent advance applications from overdrawing a source pool", async () => {
  const liability = await advanceAccount(),
    r = await postReceipt(receipt([], "50", { advanceAccountId: liability })),
    i = await invoice("100"),
    a = await application(
      "CREATE",
      applicationBody(r.item.id, [{ invoiceId: i.id, amount: "40" }]),
    ),
    b = await application(
      "CREATE",
      applicationBody(r.item.id, [{ invoiceId: i.id, amount: "40" }]),
    );
  const results = await Promise.allSettled(
    [a, b].map((d) =>
      application("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Concurrent pool reservation",
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await customerDetail(people.owner, "RECEIPT", r.item.id)).availableAdvance,
  ).toBe("10.00");
});
it("reserves future pool applications when a new application is backdated", async () => {
  const liability = await advanceAccount(),
    r = await postReceipt(receipt([], "100", { advanceAccountId: liability })),
    i = await invoice("100"),
    day = (n: number) =>
      new Date(new Date(period.start).getTime() + n * 86400000)
        .toISOString()
        .slice(0, 10),
    a = await application(
      "CREATE",
      applicationBody(r.item.id, [{ invoiceId: i.id, amount: "40" }], {
        documentDate: day(5),
        postingDate: day(5),
      }),
    );
  await application("POST", {
    id: a.id,
    expectedVersion: 1,
    reason: "Later effective application",
  });
  const b = await application(
    "CREATE",
    applicationBody(r.item.id, [{ invoiceId: i.id, amount: "80" }], {
      documentDate: day(1),
      postingDate: day(1),
    }),
  );
  await expect(
    application("POST", {
      id: b.id,
      expectedVersion: 1,
      reason: "Reject backdated pool overdraw",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
});
it("rejects another party's pool, unposted sources and pre-receipt application dates", async () => {
  const liability = await advanceAccount(),
    i = await invoice("100"),
    other = await party(),
    late = period.end;
  const r = await postReceipt(
      receipt([], "100", { advanceAccountId: liability, postingDate: late }),
    ),
    draft = await customer(
      "CREATE",
      receipt([], "100", { advanceAccountId: liability }),
    );
  for (const input of [
    applicationBody(r.item.id, [{ invoiceId: i.id, amount: "10" }], {
      partyId: other,
    }),
    applicationBody(draft.id, [{ invoiceId: i.id, amount: "10" }]),
    applicationBody(r.item.id, [{ invoiceId: i.id, amount: "10" }]),
  ]) {
    const d = await application("CREATE", input);
    await expect(
      application("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Invalid advance source",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
  }
});
it("applies retained advance after source bank archive and preserves immutable fund events", async () => {
  const liability = await advanceAccount(),
    cashGl = await account({ controlType: "CASH" }),
    b = (
      await master("CASH_CREATE", {
        name: prefix + " retained bank",
        kind: "BANK",
        glAccountId: cashGl,
        currency: "PKR",
        reason: "Synthetic retained source bank",
      })
    ).id,
    r = await postReceipt(
      receipt([], "100", { cashAccountId: b, advanceAccountId: liability }),
    ),
    i = await invoice("100");
  await master("CASH_ARCHIVE", {
    id: b,
    expectedVersion: 1,
    reason: "Retain old source bank",
  });
  const a = await application(
    "CREATE",
    applicationBody(r.item.id, [{ invoiceId: i.id, amount: "10" }]),
  );
  await application("POST", {
    id: a.id,
    expectedVersion: 1,
    reason: "Apply existing held balance",
  });
  await expect(
    db.financeClientBalanceEvent.deleteMany({
      where: { sourceDocumentId: r.item.id },
    }),
  ).rejects.toThrow();
  expect(
    (await customerDetail(people.owner, "RECEIPT", r.item.id)).availableAdvance,
  ).toBe("90.00");
});
it("replays application posting without duplicating AR or pool events", async () => {
  const liability = await advanceAccount(),
    r = await postReceipt(receipt([], "100", { advanceAccountId: liability })),
    i = await invoice("100"),
    a = await application(
      "CREATE",
      applicationBody(r.item.id, [{ invoiceId: i.id, amount: "10" }]),
    ),
    key = crypto.randomUUID(),
    input = {
      id: a.id,
      expectedVersion: 1,
      reason: "Permanent application replay",
    };
  expect(await application("POST", input, key)).toEqual(
    await application("POST", input, key),
  );
  expect(
    await db.financeClientBalanceEvent.count({ where: { documentId: a.id } }),
  ).toBe(1);
  expect(await outstanding(i.id)).toBe("90.00");
});
it("denies runtime direct balance mutation and private capacity helper after setup replay", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
    await sql.query("SET ROLE encova_app");
    for (const statement of [
      'DELETE FROM "FinanceClientBalanceEvent"',
      `SELECT encova_finance_client_capacity('${crypto.randomUUID()}',DATE '${period.start}')`,
    ])
      await expect(sql.query(statement)).rejects.toMatchObject({
        code: "42501",
      });
    await sql.query("RESET ROLE");
    await sql.query("SET ROLE authenticated");
    await expect(
      sql.query('SELECT * FROM "FinanceClientBalanceEvent"'),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await sql.end();
  }
});
async function documentCommand(
  resource: Parameters<typeof customerCommand>[2],
  action: Parameters<typeof customerCommand>[3],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return customerCommand(v.actor, v.proof, resource, action, input, key);
}
async function creditInput(
  invoiceId: string,
  amount: string,
  patch: Record<string, unknown> = {},
) {
  const i = await invoiceDetail(people.owner, invoiceId);
  return {
    reference: prefix + ".CN" + ++count,
    partyId: client,
    invoiceId,
    advanceAccountId: await advanceAccount(),
    documentDate: period.start,
    postingDate: period.start,
    description: "Synthetic customer credit",
    evidence: "Reviewed source correction",
    currency: "PKR",
    creditLines: [{ invoiceLineId: i.item.lines[0].id, amount }],
    reason: "Review eligible original credit",
    ...patch,
  };
}
async function postCredit(input: unknown) {
  const d = await documentCommand("CUSTOMER_CREDIT", "CREATE", input);
  await documentCommand("CUSTOMER_CREDIT", "POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post eligible customer credit",
  });
  return customerDetail(people.owner, "CUSTOMER_CREDIT", d.id);
}
const refundInput = (
  sourceDocumentId: string,
  cashAmount: string,
  patch: Record<string, unknown> = {},
) => ({
  reference: prefix + ".RFN" + ++count,
  partyId: client,
  sourceDocumentId,
  cashAccountId: bank,
  cashAmount,
  documentDate: period.start,
  postingDate: period.start,
  description: "Return held client money",
  evidence: "Approved synthetic refund",
  reason: "Reviewed client refund",
  ...patch,
});
async function postRefund(input: unknown) {
  const d = await documentCommand("CUSTOMER_REFUND", "CREATE", input);
  await documentCommand("CUSTOMER_REFUND", "POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Return actual held funds",
  });
  return customerDetail(people.owner, "CUSTOMER_REFUND", d.id);
}
const nextDate = (n = 1) =>
  new Date(new Date(period.start).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
async function reverse(
  resource: Parameters<typeof customerCommand>[2],
  id: string,
  patch: Record<string, unknown> = {},
  key = crypto.randomUUID(),
) {
  return documentCommand(
    resource,
    "REVERSE",
    {
      id,
      expectedVersion: 2,
      postingDate: nextDate(),
      reason: "Dated reviewed correction",
      ...patch,
    },
    key,
  );
}
it("credits an unpaid earned invoice against receivables without cash or expense", async () => {
  const i = await invoice("100"),
    c = await postCredit(await creditInput(i.id, "40"));
  expect(c.item.creditSplit).toMatchObject({
    arAmount: "40.00",
    balanceAmount: "0.00",
  });
  expect(await outstanding(i.id)).toBe("60.00");
  expect(
    c.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [ar, "0.00", "40.00"],
    [revenue, "40.00", "0.00"],
  ]);
  expect(c.item.creditLines[0].amount).toBe("40.00");
});
it("turns paid invoice credits into refundable client liability, never a refund expense", async () => {
  const i = await invoice("100");
  await postReceipt(receipt([{ invoiceId: i.id, amount: "100" }], "100"));
  const input = await creditInput(i.id, "40"),
    c = await postCredit(input),
    r = await postRefund(refundInput(c.item.id, "25"));
  expect(c.item.creditSplit).toMatchObject({
    arAmount: "0.00",
    balanceAmount: "40.00",
  });
  expect(c.availableAdvance).toBe("40.00");
  expect(
    r.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [input.advanceAccountId, "25.00", "0.00"],
    [cash, "0.00", "25.00"],
  ]);
  expect(
    (await customerDetail(people.owner, "CUSTOMER_CREDIT", c.item.id))
      .availableAdvance,
  ).toBe("15.00");
  expect(await outstanding(i.id)).toBe("0.00");
});
it("splits partially-paid invoice credits between AR and customer balance at posting", async () => {
  const i = await invoice("100");
  await postReceipt(receipt([{ invoiceId: i.id, amount: "60" }], "60"));
  const c = await postCredit(await creditInput(i.id, "70"));
  expect(c.item.creditSplit).toMatchObject({
    arAmount: "40.00",
    balanceAmount: "30.00",
  });
  expect(await outstanding(i.id)).toBe("0.00");
  expect(c.item.entry!.lines.map((l) => [l.debit, l.credit])).toEqual([
    ["0.00", "40.00"],
    ["0.00", "30.00"],
    ["70.00", "0.00"],
  ]);
});
it("recomputes a draft credit's settlement split when the invoice is paid before credit posting", async () => {
  const i = await invoice("100"),
    c = await documentCommand(
      "CUSTOMER_CREDIT",
      "CREATE",
      await creditInput(i.id, "40"),
    );
  await postReceipt(receipt([{ invoiceId: i.id, amount: "100" }], "100"));
  await documentCommand("CUSTOMER_CREDIT", "POST", {
    id: c.id,
    expectedVersion: 1,
    reason: "Recheck current paid balance",
  });
  expect(
    (await customerDetail(people.owner, "CUSTOMER_CREDIT", c.id)).item
      .creditSplit,
  ).toMatchObject({ arAmount: "0.00", balanceAmount: "40.00" });
});
it("cancels deferred billing through its liability without recognizing revenue", async () => {
  const def = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "DEFERRED_REVENUE",
    }),
    d = await command(
      "CREATE",
      body({
        lines: [
          line({
            unitRate: "100",
            recognition: "DEFERRED",
            deferredAccountId: def,
          }),
        ],
      }),
    );
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Bill unearned service",
  });
  const c = await postCredit(await creditInput(d.id, "30"));
  expect(c.item.entry!.lines.map((l) => l.accountId)).toEqual([ar, def]);
  const balance = await db.financeDeferredRevenueEvent.aggregate({
    where: { invoiceLine: { invoiceId: d.id } },
    _sum: { amount: true },
  });
  expect(balance._sum.amount!.toFixed(2)).toBe("70.00");
});
it("caps cumulative credit notes and concurrent credit posting at original eligible line amounts", async () => {
  const i = await invoice("100"),
    input = await creditInput(i.id, "60"),
    a = await documentCommand("CUSTOMER_CREDIT", "CREATE", input),
    b = await documentCommand("CUSTOMER_CREDIT", "CREATE", {
      ...input,
      reference: prefix + " competing",
    });
  const results = await Promise.allSettled(
    [a, b].map((d) =>
      documentCommand("CUSTOMER_CREDIT", "POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Concurrent eligible credit",
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await outstanding(i.id)).toBe("40.00");
  const extra = await documentCommand(
    "CUSTOMER_CREDIT",
    "CREATE",
    await creditInput(i.id, "41"),
  );
  await expect(
    documentCommand("CUSTOMER_CREDIT", "POST", {
      id: extra.id,
      expectedVersion: 1,
      reason: "Cumulative cap check",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CREDIT_UNAVAILABLE" });
});
it("rejects cross-invoice credit lines and backdated credit that would invalidate future settlement", async () => {
  const i = await invoice("100"),
    other = await invoice("100"),
    input = await creditInput(i.id, "20"),
    wrong = (await invoiceDetail(people.owner, other.id)).item.lines[0].id;
  await expect(
    documentCommand("CUSTOMER_CREDIT", "CREATE", {
      ...input,
      creditLines: [{ invoiceLineId: wrong, amount: "20" }],
    }),
  ).rejects.toThrow();
  await postReceipt(
    receipt([{ invoiceId: i.id, amount: "100" }], "100", {
      postingDate: nextDate(5),
    }),
  );
  const c = await documentCommand("CUSTOMER_CREDIT", "CREATE", input);
  await expect(
    documentCommand("CUSTOMER_CREDIT", "POST", {
      id: c.id,
      expectedVersion: 1,
      reason: "Backdated settlement ordering",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_SETTLEMENT_ORDER" });
  expect(await outstanding(i.id)).toBe("0.00");
});
it("prevents concurrent refunds from overdrawing dated client funds", async () => {
  const liability = await advanceAccount(),
    r = await postReceipt(receipt([], "100", { advanceAccountId: liability })),
    a = await documentCommand(
      "CUSTOMER_REFUND",
      "CREATE",
      refundInput(r.item.id, "60"),
    ),
    b = await documentCommand(
      "CUSTOMER_REFUND",
      "CREATE",
      refundInput(r.item.id, "60"),
    );
  const results = await Promise.allSettled(
    [a, b].map((d) =>
      documentCommand("CUSTOMER_REFUND", "POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Concurrent refund cap",
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await customerDetail(people.owner, "RECEIPT", r.item.id)).availableAdvance,
  ).toBe("40.00");
});
it("applies paid customer credit to another invoice without moving cash twice", async () => {
  const a = await invoice("100"),
    b = await invoice("100");
  await postReceipt(receipt([{ invoiceId: a.id, amount: "100" }], "100"));
  const c = await postCredit(await creditInput(a.id, "40")),
    app = await application(
      "CREATE",
      applicationBody(c.item.id, [{ invoiceId: b.id, amount: "25" }]),
    );
  await application("POST", {
    id: app.id,
    expectedVersion: 1,
    reason: "Apply client credit to other invoice",
  });
  expect(await outstanding(b.id)).toBe("75.00");
  expect(
    (await customerDetail(people.owner, "CUSTOMER_CREDIT", c.item.id))
      .availableAdvance,
  ).toBe("15.00");
  expect(
    (
      await customerDetail(people.owner, "ADVANCE_APPLICATION", app.id)
    ).item.entry!.lines.some((l) => l.accountId === cash),
  ).toBe(false);
});
it("reverses receipts with opposite dated events while preserving earlier AR history", async () => {
  const i = await invoice("100"),
    r = await postReceipt(receipt([{ invoiceId: i.id, amount: "60" }], "60")),
    key = crypto.randomUUID(),
    input = {
      id: r.item.id,
      expectedVersion: 2,
      postingDate: nextDate(),
      reason: "Correct receipt on next date",
    };
  const a = await documentCommand("RECEIPT", "REVERSE", input, key),
    b = await documentCommand("RECEIPT", "REVERSE", input, key);
  expect(a).toEqual(b);
  expect(await outstanding(i.id)).toBe("100.00");
  const before = await db.financeReceivableEvent.aggregate({
    where: { invoiceId: i.id, effectiveDate: { lte: new Date(period.start) } },
    _sum: { amount: true },
  });
  expect(before._sum.amount!.toFixed(2)).toBe("40.00");
  expect(
    (await customerDetail(people.owner, "RECEIPT", r.item.id)).item.state,
  ).toBe("REVERSED");
  await expect(reverse("RECEIPT", r.item.id)).rejects.toMatchObject({
    code: "FINANCE_SETTLEMENT_UNAVAILABLE",
  });
});
it("requires reversing applications before undoing their source advance receipt", async () => {
  const liability = await advanceAccount(),
    r = await postReceipt(receipt([], "100", { advanceAccountId: liability })),
    i = await invoice("100"),
    a = await application(
      "CREATE",
      applicationBody(r.item.id, [{ invoiceId: i.id, amount: "40" }]),
    );
  await application("POST", {
    id: a.id,
    expectedVersion: 1,
    reason: "Apply held funds",
  });
  await expect(reverse("RECEIPT", r.item.id)).rejects.toMatchObject({
    code: "FINANCE_ADVANCE_UNAVAILABLE",
  });
  await reverse("ADVANCE_APPLICATION", a.id);
  await reverse("RECEIPT", r.item.id);
  expect(
    (await customerDetail(people.owner, "RECEIPT", r.item.id)).availableAdvance,
  ).toBe("0.00");
  expect(await outstanding(i.id)).toBe("100.00");
});
it("requires refund reversal before undoing a consumed paid credit note", async () => {
  const i = await invoice("100");
  await postReceipt(receipt([{ invoiceId: i.id, amount: "100" }], "100"));
  const c = await postCredit(await creditInput(i.id, "40")),
    r = await postRefund(refundInput(c.item.id, "25"));
  await expect(reverse("CUSTOMER_CREDIT", c.item.id)).rejects.toMatchObject({
    code: "FINANCE_ADVANCE_UNAVAILABLE",
  });
  await reverse("CUSTOMER_REFUND", r.item.id);
  await reverse("CUSTOMER_CREDIT", c.item.id);
  expect(
    (await customerDetail(people.owner, "CUSTOMER_CREDIT", c.item.id))
      .availableAdvance,
  ).toBe("0.00");
  expect(await outstanding(i.id)).toBe("0.00");
});
it("restores deferred billing and credit eligibility only on the dated credit reversal", async () => {
  const def = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "DEFERRED_REVENUE",
    }),
    i = await command(
      "CREATE",
      body({
        lines: [
          line({
            unitRate: "100",
            recognition: "DEFERRED",
            deferredAccountId: def,
          }),
        ],
      }),
    );
  await command("POST", {
    id: i.id,
    expectedVersion: 1,
    reason: "Deferred source",
  });
  const c = await postCredit(await creditInput(i.id, "40"));
  await reverse("CUSTOMER_CREDIT", c.item.id);
  const all = await db.financeDeferredRevenueEvent.aggregate({
      where: { invoiceLine: { invoiceId: i.id } },
      _sum: { amount: true },
    }),
    earlier = await db.financeDeferredRevenueEvent.aggregate({
      where: {
        invoiceLine: { invoiceId: i.id },
        effectiveDate: { lte: new Date(period.start) },
      },
      _sum: { amount: true },
    });
  expect(all._sum.amount!.toFixed(2)).toBe("100.00");
  expect(earlier._sum.amount!.toFixed(2)).toBe("60.00");
  const next = await creditInput(i.id, "100", {
    documentDate: nextDate(),
    postingDate: nextDate(),
  });
  await postCredit(next);
  expect(await outstanding(i.id)).toBe("0.00");
});
it("releases invoice settlement into held funds without returning cash and supports a dated undo", async () => {
  const i = await invoice("100"),
    r = await postReceipt(receipt([{ invoiceId: i.id, amount: "100" }], "100")),
    liability = await advanceAccount(),
    released = await documentCommand("RECEIPT", "UNALLOCATE", {
      id: r.item.id,
      expectedVersion: 2,
      postingDate: nextDate(),
      advanceAccountId: liability,
      reason: "Keep cash but release invoice settlement",
    }),
    u = await customerDetail(people.owner, "UNALLOCATION", released.id);
  expect(u.availableAdvance).toBe("100.00");
  expect(await outstanding(i.id)).toBe("100.00");
  expect(u.item.entry!.lines.some((l) => l.accountId === cash)).toBe(false);
  await expect(
    reverse("RECEIPT", r.item.id, { postingDate: nextDate(2) }),
  ).rejects.toMatchObject({ code: "FINANCE_SETTLEMENT_UNAVAILABLE" });
  await reverse("UNALLOCATION", u.item.id, { postingDate: nextDate(2) });
  expect(await outstanding(i.id)).toBe("0.00");
  await reverse("RECEIPT", r.item.id, { postingDate: nextDate(3) });
  expect(await outstanding(i.id)).toBe("100.00");
});
it("blocks release reversal after its held funds are consumed or invoice is resettled", async () => {
  const i = await invoice("100"),
    r = await postReceipt(receipt([{ invoiceId: i.id, amount: "100" }], "100")),
    u = await documentCommand("RECEIPT", "UNALLOCATE", {
      id: r.item.id,
      expectedVersion: 2,
      postingDate: nextDate(),
      advanceAccountId: await advanceAccount(),
      reason: "Release original settlement",
    });
  await postRefund(
    refundInput(u.id, "10", {
      documentDate: nextDate(),
      postingDate: nextDate(),
    }),
  );
  await expect(
    reverse("UNALLOCATION", u.id, { postingDate: nextDate(2) }),
  ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
});
it("keeps credit/split/dated events immutable and rejects forged direct runtime effects", async () => {
  const i = await invoice("100"),
    c = await postCredit(await creditInput(i.id, "10"));
  await expect(
    db.financeCustomerCreditLine.updateMany({
      where: { documentId: c.item.id },
      data: { amount: "1" },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeCustomerCreditSplit.update({
      where: { documentId: c.item.id },
      data: { arAmount: "1" },
    }),
  ).rejects.toThrow();
  await expect(
    db.financeInvoiceCreditEvent.deleteMany({
      where: { customerDocumentId: c.item.id },
    }),
  ).rejects.toThrow();
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query(await readFile("supabase/setup.sql", "utf8"));
    await sql.query("SET ROLE encova_app");
    for (const statement of [
      'DELETE FROM "FinanceCustomerCreditSplit"',
      `SELECT encova_finance_customer_fund('${c.item.id}')`,
      `SELECT encova_finance_credit_capacity('${c.item.creditLines[0].invoiceLineId}',DATE '${period.start}')`,
    ])
      await expect(sql.query(statement)).rejects.toMatchObject({
        code: "42501",
      });
  } finally {
    await sql.end();
  }
});
it("rejects release undo when another receipt has already resettled the invoice", async () => {
  const i = await invoice("100"),
    r = await postReceipt(receipt([{ invoiceId: i.id, amount: "100" }], "100")),
    u = await documentCommand("RECEIPT", "UNALLOCATE", {
      id: r.item.id,
      expectedVersion: 2,
      postingDate: nextDate(),
      advanceAccountId: await advanceAccount(),
      reason: "Release settlement without cash return",
    });
  await postReceipt(
    receipt([{ invoiceId: i.id, amount: "100" }], "100", {
      documentDate: nextDate(),
      postingDate: nextDate(),
    }),
  );
  await expect(
    reverse("UNALLOCATION", u.id, { postingDate: nextDate(2) }),
  ).rejects.toMatchObject({ code: "FINANCE_ALLOCATION_UNAVAILABLE" });
  expect(await outstanding(i.id)).toBe("0.00");
  expect(
    (await customerDetail(people.owner, "UNALLOCATION", u.id)).availableAdvance,
  ).toBe("100.00");
});
it("rolls back credit split preparation on a rejected future posting date", async () => {
  const i = await invoice("100"),
    future = await newPeriod(true),
    c = await documentCommand(
      "CUSTOMER_CREDIT",
      "CREATE",
      await creditInput(i.id, "10", { postingDate: future.start }),
    );
  await expect(
    documentCommand("CUSTOMER_CREDIT", "POST", {
      id: c.id,
      expectedVersion: 1,
      reason: "Future credit cannot post",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FUTURE_DATE" });
  const view = await customerDetail(people.owner, "CUSTOMER_CREDIT", c.id);
  expect(view.item).toMatchObject({
    state: "DRAFT",
    version: 1,
    creditSplit: null,
    entry: null,
  });
});
it("rejects a forged paid-credit split even when its raw GL and fund events balance", async () => {
  const i = await invoice("100"),
    c = await documentCommand(
      "CUSTOMER_CREDIT",
      "CREATE",
      await creditInput(i.id, "10"),
    ),
    entry = crypto.randomUUID();
  await expect(
    db.$transaction(async (tx) => {
      const d = await tx.financeCustomerDocument.findUniqueOrThrow({
        where: { id: c.id },
      });
      await tx.financeCustomerCreditSplit.create({
        data: { documentId: d.id, arAmount: "0", balanceAmount: "10" },
      });
      await tx.financeJournalEntry.create({
        data: {
          id: entry,
          reference: "JRN-" + entry,
          sourceType: "CUSTOMER_DOCUMENT",
          sourceId: d.id,
          sourceAction: "POST",
          customerDocumentId: d.id,
          postingDate: d.postingDate,
          periodId: period.id,
          description: d.description,
          evidence: d.evidence,
          postedById: people.owner.id,
        },
      });
      await tx.$executeRaw`INSERT INTO "FinanceJournalLine"(id,"journalId",sequence,"accountId",description,debit,credit,"projectId","partyId","invoiceLineId") SELECT gen_random_uuid(),${entry}::uuid,x.* FROM encova_finance_customer_lines(${d.id}::uuid)x`;
      await tx.$executeRaw`SELECT encova_finance_customer_effects(${people.owner.id}::uuid,${d.id}::uuid,${entry}::uuid)`;
    }),
  ).rejects.toThrow();
  expect(
    (await customerDetail(people.owner, "CUSTOMER_CREDIT", c.id)).item,
  ).toMatchObject({ state: "DRAFT", creditSplit: null, entry: null });
  expect(await outstanding(i.id)).toBe("100.00");
});
it("denies cross-party refunds and refunds against future-reserved client funds", async () => {
  const liability = await advanceAccount(),
    r = await postReceipt(receipt([], "100", { advanceAccountId: liability })),
    other = await party(),
    bad = await documentCommand(
      "CUSTOMER_REFUND",
      "CREATE",
      refundInput(r.item.id, "10", { partyId: other }),
    );
  await expect(
    documentCommand("CUSTOMER_REFUND", "POST", {
      id: bad.id,
      expectedVersion: 1,
      reason: "Wrong party cannot refund",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
  await postRefund(
    refundInput(r.item.id, "40", {
      documentDate: nextDate(5),
      postingDate: nextDate(5),
    }),
  );
  const backdated = await documentCommand(
    "CUSTOMER_REFUND",
    "CREATE",
    refundInput(r.item.id, "80", {
      documentDate: nextDate(),
      postingDate: nextDate(),
    }),
  );
  await expect(
    documentCommand("CUSTOMER_REFUND", "POST", {
      id: backdated.id,
      expectedVersion: 1,
      reason: "Future refund reserves balance",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_ADVANCE_UNAVAILABLE" });
});
it("freezes credit-note contacts and privately renders posted PDF while denying drafts and unselected roles", async () => {
  const { creditPdf } = await import("@/modules/finance/documents/credit-pdf"),
    original = partyBody(),
    p = (await master("PARTY_CREATE", original)).id,
    i = await invoice("100", { partyId: p }),
    c = await documentCommand(
      "CUSTOMER_CREDIT",
      "CREATE",
      await creditInput(i.id, "10", { partyId: p }),
    );
  await expect(creditPdf(people.owner, c.id)).rejects.toMatchObject({
    code: "FINANCE_CREDIT_UNPOSTED",
  });
  await documentCommand("CUSTOMER_CREDIT", "POST", {
    id: c.id,
    expectedVersion: 1,
    reason: "Freeze posted credit evidence",
  });
  await master("PARTY_UPDATE", {
    ...original,
    id: p,
    expectedVersion: 1,
    address: "Changed current contact",
  });
  expect(
    (await customerDetail(people.owner, "CUSTOMER_CREDIT", c.id)).item
      .partySnapshot,
  ).toMatchObject({ address: original.address });
  const bytes = await creditPdf(people.selected, c.id);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(creditPdf(people.member, c.id)).rejects.toMatchObject({
    code: "FINANCE_FORBIDDEN",
  });
});
it("rechecks selected access after fresh proof for credit creation", async () => {
  const i = await invoice("100"),
    input = await creditInput(i.id, "10"),
    v = await proof("selected");
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  try {
    await expect(
      customerCommand(
        v.actor,
        v.proof,
        "CUSTOMER_CREDIT",
        "CREATE",
        input,
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
it("caps credits at the discounted net line amount rather than its gross selling price", async () => {
  const i = await command(
    "CREATE",
    body({
      lines: [line({ quantity: "2", unitRate: "100", discountAmount: "50" })],
    }),
  );
  await command("POST", {
    id: i.id,
    expectedVersion: 1,
    reason: "Bill explicit discounted line",
  });
  const excessive = await documentCommand(
    "CUSTOMER_CREDIT",
    "CREATE",
    await creditInput(i.id, "151"),
  );
  await expect(
    documentCommand("CUSTOMER_CREDIT", "POST", {
      id: excessive.id,
      expectedVersion: 1,
      reason: "Cannot credit original discount twice",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_CREDIT_UNAVAILABLE" });
  await postCredit(await creditInput(i.id, "150"));
  expect(await outstanding(i.id)).toBe("0.00");
});
it("serializes competing receipt reversal keys into one dated correction", async () => {
  const i = await invoice("100"),
    r = await postReceipt(receipt([{ invoiceId: i.id, amount: "100" }], "100"));
  const results = await Promise.allSettled([
    reverse("RECEIPT", r.item.id),
    reverse("RECEIPT", r.item.id),
  ]);
  expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  expect(
    await db.financeCustomerDocument.count({
      where: { reversalOfId: r.item.id },
    }),
  ).toBe(1);
  expect(await outstanding(i.id)).toBe("100.00");
});
