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
  prefix = "AG36." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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

const { ageing, ageingHistory } =
  await import("@/modules/finance/reports/ageing/service");
const { invoiceCommand } =
  await import("@/modules/finance/receivables/service");
const { billCommand } = await import("@/modules/finance/payables/service");
const { customerCommand } =
  await import("@/modules/finance/receivables/customer/service");
const { supplierCommand } =
  await import("@/modules/finance/payables/supplier/service");
const { movementCommand } = await import("@/modules/finance/treasury/service");
type Side = "AR" | "AP";
const plus = (d: string, n: number) =>
  new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
const cents = (v: string) => BigInt(v.replace(".", ""));
async function source(side: Side, action: "CREATE" | "POST", input: unknown) {
  const v = await proof();
  return side === "AR"
    ? invoiceCommand(v.actor, v.proof, action, input, crypto.randomUUID())
    : billCommand(v.actor, v.proof, action, input, crypto.randomUUID());
}
async function document(
  side: Side,
  resource: string,
  action: string,
  input: unknown,
) {
  const v = await proof();
  return side === "AR"
    ? customerCommand(
        v.actor,
        v.proof,
        resource as Parameters<typeof customerCommand>[2],
        action as Parameters<typeof customerCommand>[3],
        input,
        crypto.randomUUID(),
      )
    : supplierCommand(
        v.actor,
        v.proof,
        resource as Parameters<typeof supplierCommand>[2],
        action as Parameters<typeof supplierCommand>[3],
        input,
        crypto.randomUUID(),
      );
}
async function fixture(side: Side) {
  const p = await newPeriod(),
    name = prefix + " group " + ++count,
    party = (
      await master("PARTY_CREATE", {
        name,
        legalName: "Synthetic Legal Co",
        kind: side === "AR" ? "CLIENT" : "SUPPLIER",
        reason: "Explicit ageing source party",
      })
    ).id,
    control = await account(
      side === "AR"
        ? { controlType: "RECEIVABLES" }
        : {
            type: "LIABILITY",
            normalSide: "CREDIT",
            reportGroup: "CURRENT_LIABILITIES",
            controlType: "PAYABLES",
          },
    ),
    counter = await account(
      side === "AR"
        ? { type: "INCOME", normalSide: "CREDIT", reportGroup: "REVENUE" }
        : { type: "OPERATING_EXPENSE", reportGroup: "OPERATING_EXPENSES" },
    ),
    cash = await account({ controlType: "CASH" }),
    bank = (
      await master("CASH_CREATE", {
        name: name + " bank",
        kind: "BANK",
        glAccountId: cash,
        reason: "Synthetic settlement bank",
      })
    ).id;
  async function add(
    amount = "100.01",
    due = p.start,
    posted = true,
    quantity = "1",
  ) {
    const d = await source(side, "CREATE", {
      reference: name + " doc " + ++count,
      partyId: party,
      ...(side === "AR"
        ? { receivableAccountId: control, invoiceDate: p.start }
        : { kind: "BILL", payableAccountId: control, billDate: p.start }),
      postingDate: p.start,
      dueDate: due,
      description: "Actual dated ageing source",
      evidence: "Reviewed original synthetic source",
      lines: [
        {
          description: "Actual original service",
          quantity,
          unitRate: amount,
          ...(side === "AR"
            ? { recognition: "EARNED", revenueAccountId: counter }
            : { treatment: "EXPENSE", costAccountId: counter }),
        },
      ],
      reason: "Recognize actual dated source",
    });
    if (posted)
      await source(side, "POST", {
        id: d.id,
        expectedVersion: d.version,
        reason: "Post actual dated source",
      });
    return d;
  }
  async function settle(id: string, amount = "20.00", offset = 2) {
    const d = await document(
      side,
      side === "AR" ? "RECEIPT" : "PAYMENT",
      "CREATE",
      {
        reference: name + " settlement " + ++count,
        partyId: party,
        cashAccountId: bank,
        documentDate: plus(p.start, offset),
        postingDate: plus(p.start, offset),
        description: "Actual later settlement",
        evidence: "Reviewed synthetic actual settlement",
        cashAmount: amount,
        allocations: [{ [side === "AR" ? "invoiceId" : "billId"]: id, amount }],
        reason: "Actual dated settlement",
      },
    );
    await document(side, side === "AR" ? "RECEIPT" : "PAYMENT", "POST", {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post actual dated settlement",
    });
    return d;
  }
  async function reverse(resource: string, id: string, offset = 3) {
    return document(side, resource, "REVERSE", {
      id,
      expectedVersion: 2,
      postingDate: plus(p.start, offset),
      reason: "Actual dated opposite event",
    });
  }
  async function credit(id: string, amount = "30.00", offset = 3) {
    const advance = await account(
        side === "AR"
          ? {
              type: "LIABILITY",
              normalSide: "CREDIT",
              reportGroup: "CURRENT_LIABILITIES",
              controlType: "CLIENT_ADVANCE",
            }
          : { controlType: "SUPPLIER_ADVANCE" },
      ),
      line =
        side === "AR"
          ? await db.financeInvoiceLine.findFirstOrThrow({
              where: { invoiceId: id },
            })
          : await db.financeBillLine.findFirstOrThrow({
              where: { billId: id },
            }),
      resource = side === "AR" ? "CUSTOMER_CREDIT" : "SUPPLIER_CREDIT",
      d = await document(side, resource, "CREATE", {
        reference: name + " credit " + ++count,
        partyId: party,
        [side === "AR" ? "invoiceId" : "billId"]: id,
        advanceAccountId: advance,
        documentDate: plus(p.start, offset),
        postingDate: plus(p.start, offset),
        description: "Actual dated source credit",
        evidence: "Reviewed original purpose correction",
        creditLines: [
          { [side === "AR" ? "invoiceLineId" : "billLineId"]: line.id, amount },
        ],
        reason: "Actual original-line credit",
      });
    await document(side, resource, "POST", {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post actual dated credit",
    });
    return d;
  }
  const report = (offset = 0, extra = {}) =>
    ageing(people.owner, side, {
      asOf: plus(p.start, offset),
      q: name,
      ...extra,
    });
  const history = (id: string, offset = 0, extra = {}) =>
    ageingHistory(people.owner, side, {
      asOf: plus(p.start, offset),
      documentId: id,
      ...extra,
    });
  return {
    side,
    p,
    name,
    party,
    control,
    counter,
    cash,
    bank,
    add,
    settle,
    reverse,
    credit,
    report,
    history,
  };
}
for (const side of ["AR", "AP"] as const) {
  it(
    side +
      " reconstructs original and partial settlement at their real cutoffs instead of current payment state",
    async () => {
      const f = await fixture(side),
        i = await f.add();
      await f.settle(i.id);
      expect((await f.report()).items[0].openAmount).toBe("100.01");
      expect((await f.report(1)).items[0].openAmount).toBe("100.01");
      expect((await f.report(2)).items[0].openAmount).toBe("80.01");
      expect((await f.history(i.id, 1)).items).toHaveLength(1);
      expect(
        (await f.history(i.id, 2)).items.map((e) => e.runningBalance),
      ).toEqual(["100.01", "80.01"]);
      expect((await f.report(2)).reconciliation).toMatchObject({
        ready: true,
        difference: "0.00",
      });
    },
  );
  it(
    side +
      " excludes unposted drafts and settles only from the effective date with explicit settled display",
    async () => {
      const f = await fixture(side),
        i = await f.add(),
        draft = await f.add("50.00", f.p.start, false);
      await f.settle(i.id, "100.01");
      expect((await f.report()).items).toHaveLength(1);
      expect((await f.report(2)).items).toHaveLength(0);
      expect(
        (await f.report(2, { includeSettled: "YES" })).items[0],
      ).toMatchObject({ id: i.id, openAmount: "0.00" });
      await expect(f.history(draft.id)).rejects.toMatchObject({ status: 404 });
      await expect(f.history(i.id, -1)).rejects.toMatchObject({ status: 404 });
    },
  );
  it(
    side +
      " dated settlement reversals restore open amounts only from the opposite date",
    async () => {
      const f = await fixture(side),
        i = await f.add(),
        d = await f.settle(i.id);
      await f.reverse(side === "AR" ? "RECEIPT" : "PAYMENT", d.id);
      expect((await f.report(1)).items[0].openAmount).toBe("100.01");
      expect((await f.report(2)).items[0].openAmount).toBe("80.01");
      expect((await f.report(3)).items[0].openAmount).toBe("100.01");
      expect((await f.history(i.id, 3)).items.map((e) => e.amount)).toEqual([
        "100.01",
        "-20.00",
        "20.00",
      ]);
    },
  );
  it(
    side +
      " dated original-line credits and credit reversals remain historical and do not erase original billing",
    async () => {
      const f = await fixture(side),
        i = await f.add(),
        d = await f.credit(i.id);
      await f.reverse(
        side === "AR" ? "CUSTOMER_CREDIT" : "SUPPLIER_CREDIT",
        d.id,
        4,
      );
      expect((await f.report(2)).items[0]).toMatchObject({
        originalAmount: "100.01",
        openAmount: "100.01",
      });
      expect((await f.report(3)).items[0].openAmount).toBe("70.01");
      expect((await f.report(4)).items[0].openAmount).toBe("100.01");
    },
  );
  it(
    side +
      " ageing buckets include due today and exact30/31/60/61/90/91 boundaries",
    async () => {
      const f = await fixture(side),
        i = await f.add();
      for (const [offset, bucket] of [
        [0, "NOT_DUE"],
        [1, "DAYS_1_30"],
        [30, "DAYS_1_30"],
        [31, "DAYS_31_60"],
        [60, "DAYS_31_60"],
        [61, "DAYS_61_90"],
        [90, "DAYS_61_90"],
        [91, "OVER_90"],
      ] as const) {
        const row = (await f.report(offset)).items.find((v) => v.id === i.id);
        expect(row).toMatchObject({
          daysPastDue: offset,
          bucket,
          openAmount: "100.01",
        });
      }
    },
  );
}
it("company buckets, control proof and dated-event digest remain complete under empty display search and bucket filters", async () => {
  const f = await fixture("AR"),
    before = await f.report(91);
  await f.add();
  const full = await f.report(91),
    empty = await f.report(91, { q: crypto.randomUUID(), bucket: "NOT_DUE" });
  expect(empty.items).toEqual([]);
  expect(empty.totals).toEqual(full.totals);
  expect(empty.reconciliation).toEqual(full.reconciliation);
  expect(empty.metadata.filters.subledgerDigest).toBe(
    full.metadata.filters.subledgerDigest,
  );
  expect(cents(full.totals.openAmount) - cents(before.totals.openAmount)).toBe(
    10001n,
  );
  expect(cents(full.totals.over90) - cents(before.totals.over90)).toBe(10001n);
});
it("stable27-document pages and27-event running balances retain complete earlier-page carry", async () => {
  const f = await fixture("AR"),
    i = await f.add("100.00");
  for (let n = 0; n < 26; n++) await f.add("1.00");
  const a = await f.report(),
    b = await f.report(0, { page: 2 });
  expect(a).toMatchObject({ total: 27, page: 1, pages: 2 });
  expect(a.items).toHaveLength(25);
  expect(b.items).toHaveLength(2);
  for (let n = 0; n < 26; n++) await f.settle(i.id, "1.00", 2);
  const h1 = await f.history(i.id, 2),
    h2 = await f.history(i.id, 2, { page: 2 });
  expect(h1).toMatchObject({ total: 27, page: 1, pages: 2 });
  expect(h1.items.at(-1)?.runningBalance).toBe("76.00");
  expect(h2.items.map((e) => e.runningBalance)).toEqual(["75.00", "74.00"]);
  expect(new Set([...a.items, ...b.items].map((v) => v.id)).size).toBe(27);
}, 30000);
it("archived party/control history remains included and cutoff date extremes do not underflow", async () => {
  const f = await fixture("AP"),
    i = await f.add();
  const party = await db.financeParty.findUniqueOrThrow({
    where: { id: f.party },
  });
  await master("PARTY_ARCHIVE", {
    id: party.id,
    expectedVersion: party.version,
    reason: "Retain source party history",
  });
  const account = await db.financeAccount.findUniqueOrThrow({
    where: { id: f.control },
  });
  await config("ACCOUNT_ARCHIVE", {
    id: account.id,
    expectedVersion: account.version,
    reason: "Retain payable control history",
  });
  expect((await f.report()).items[0]).toMatchObject({
    id: i.id,
    accountActive: false,
    openAmount: "100.01",
  });
  expect(
    (await ageing(people.owner, "AP", { asOf: "0001-01-01" })).totals
      .openAmount,
  ).toBe("0.00");
  expect(
    (await ageing(people.owner, "AP", { asOf: "9999-12-31", page: 10000 }))
      .reconciliation.difference,
  ).toBe("0.00");
});
it("actual founder noncash bill settlement reduces historical AP without requiring a cash payment", async () => {
  const f = await fixture("AP"),
    i = await f.add(),
    founder = (
      await master("PARTY_CREATE", {
        name: prefix + " founder " + ++count,
        legalName: "Synthetic Founder",
        kind: "OTHER",
        reason: "Actual contributor identity",
      })
    ).id,
    control = await account({
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "FOUNDER_PAYABLE",
    }),
    v = await proof(),
    d = await movementCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        kind: "FOUNDER_BILL_SETTLEMENT",
        reference: prefix + " noncash settlement " + ++count,
        documentDate: plus(f.p.start, 2),
        postingDate: plus(f.p.start, 2),
        description: "Actual founder settles supplier directly",
        evidence: "Reviewed actual personal payment",
        amount: "20.00",
        partyId: founder,
        controlAccountId: control,
        counterAccountId: f.control,
        billId: i.id,
        reason: "Classify founder liability correctly",
      },
      crypto.randomUUID(),
    ),
    w = await proof();
  await movementCommand(
    w.actor,
    w.proof,
    "POST",
    {
      id: d.id,
      expectedVersion: d.version,
      reason: "Post actual noncash supplier settlement",
    },
    crypto.randomUUID(),
  );
  expect((await f.report(1)).items[0].openAmount).toBe("100.01");
  expect((await f.report(2)).items[0].openAmount).toBe("80.01");
});
it("read operations create no GL/audit or source mutation and selected/current permissions are rechecked", async () => {
  const f = await fixture("AR"),
    i = await f.add(),
    n = await db.financeJournalEntry.count(),
    audit = await db.financeAuditEvent.count();
  await f.report();
  await f.history(i.id);
  expect(await db.financeJournalEntry.count()).toBe(n);
  expect(await db.financeAuditEvent.count()).toBe(audit);
  expect(
    (await ageing(people.selected, "AR", { asOf: f.p.start, q: f.name })).total,
  ).toBe(1);
  for (const who of ["other", "hr", "lead", "member"])
    for (const side of ["AR", "AP"] as const)
      await expect(
        ageing(people[who], side, { asOf: f.p.start }),
      ).rejects.toMatchObject({ status: 403 });
  await db.financeGrant.updateMany({
    where: { userId: people.selected.id },
    data: { revokedAt: new Date(), revokedById: people.owner.id },
  });
  await expect(
    ageing(people.selected, "AR", { asOf: f.p.start }),
  ).rejects.toMatchObject({ status: 403 });
  env.FINANCE_ENABLED = false;
  await expect(f.report()).rejects.toMatchObject({ status: 404 });
  env.FINANCE_ENABLED = true;
});
it("raw ageing helpers stay unavailable to application and Data API roles while the checked interface is granted only to the application", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    for (const role of ["encova_app", "anon", "authenticated"])
      for (const fn of [
        "encova_finance_ageing_events(text,date)",
        "encova_finance_ageing_documents(text,date)",
        "encova_finance_ageing_report(text,date,text,integer,integer,boolean,text)",
        "encova_finance_ageing_history(text,date,uuid,integer)",
      ])
        expect(
          (
            await sql.query(
              "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
              [role, fn],
            )
          ).rows[0].allowed,
        ).toBe(false);
    expect(
      (
        await sql.query(
          "SELECT has_function_privilege('encova_app','encova_finance_ageing_read(uuid,text,jsonb)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
  } finally {
    await sql.end();
  }
});
for (const side of ["AR", "AP"] as const)
  it(
    side +
      " settlement release and its dated undo change open amounts without returning cash",
    async () => {
      const f = await fixture(side),
        i = await f.add(),
        d = await f.settle(i.id),
        advance = await account(
          side === "AR"
            ? {
                type: "LIABILITY",
                normalSide: "CREDIT",
                reportGroup: "CURRENT_LIABILITIES",
                controlType: "CLIENT_ADVANCE",
              }
            : { controlType: "SUPPLIER_ADVANCE" },
        ),
        released = await document(
          side,
          side === "AR" ? "RECEIPT" : "PAYMENT",
          "UNALLOCATE",
          {
            id: d.id,
            expectedVersion: 2,
            postingDate: plus(f.p.start, 3),
            advanceAccountId: advance,
            reason: "Retain cash but release actual settlement",
          },
        );
      await f.reverse("UNALLOCATION", released.id, 4);
      expect((await f.report(2)).items[0].openAmount).toBe("80.01");
      expect((await f.report(3)).items[0].openAmount).toBe("100.01");
      expect((await f.report(4)).items[0].openAmount).toBe("80.01");
      const e =
        side === "AR"
          ? await db.financeJournalEntry.findUniqueOrThrow({
              where: { customerDocumentId: released.id },
            })
          : await db.financeJournalEntry.findUniqueOrThrow({
              where: { supplierDocumentId: released.id },
            });
      expect(
        await db.financeJournalLine.count({
          where: { journalId: e.id, accountId: f.cash },
        }),
      ).toBe(0);
    },
  );
it("aggregate ageing retains exact paisa beyond a single document maximum", async () => {
  const f = await fixture("AR"),
    before = await f.report();
  await f.add("99999999999999.999999", f.p.start, true, "10000");
  await f.add("99999999999999.999999", f.p.start, true, "10000");
  const r = await f.report();
  expect(r.items).toHaveLength(2);
  expect(cents(r.totals.openAmount) - cents(before.totals.openAmount)).toBe(
    199999999999999999998n,
  );
  expect(r.reconciliation.difference).toBe("0.00");
});
