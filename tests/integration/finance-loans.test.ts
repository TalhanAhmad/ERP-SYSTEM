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
const { movementCommand, movementDetail, cashRegister } =
  await import("@/modules/finance/treasury/service");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "L22." + crypto.randomUUID().slice(0, 7).toUpperCase(),
  password = "Bill-synthetic-test-only-9#";
let count = 0,
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
  await account({
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
  await party();
  cash = (
    await master("CASH_CREATE", {
      name: prefix + " cash",
      kind: "BANK",
      glAccountId: cash,
      reason: "Synthetic bill cash master",
    })
  ).id;
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

async function move(
  action: Parameters<typeof movementCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return movementCommand(v.actor, v.proof, action, input, key);
}
async function banks() {
  const make = async () => {
    const gl = await account({ controlType: "CASH" });
    const b = await master("CASH_CREATE", {
      name: prefix + " bank " + ++count,
      kind: "BANK",
      glAccountId: gl,
      reason: "Synthetic transfer cash master",
    });
    return { id: b.id, gl };
  };
  return { a: await make(), b: await make() };
}
const day = (n: number) =>
  new Date(new Date(period.start).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);

const { loanCommand, loanDetail, loans } =
  await import("@/modules/finance/funding/loans/service");
const { loanRead, loanMutation } =
  await import("@/modules/finance/funding/loans/http");
async function register(
  action: Parameters<typeof loanCommand>[2],
  input: unknown,
  key = crypto.randomUUID(),
  who = "owner",
) {
  const v = await proof(who);
  return loanCommand(v.actor, v.proof, action, input, key);
}
async function loan(
  direction = "RECEIVED",
  patch: Record<string, unknown> = {},
) {
  const received = direction === "RECEIVED",
    p = await party({ kind: "OTHER" }),
    principal = await account({
      type: received ? "LIABILITY" : "ASSET",
      normalSide: received ? "CREDIT" : "DEBIT",
      reportGroup: received ? "CURRENT_LIABILITIES" : "CURRENT_ASSETS",
      controlType: received ? "LOAN_PAYABLE" : "LOAN_RECEIVABLE",
    }),
    interest = await account({
      type: received ? "LIABILITY" : "ASSET",
      normalSide: received ? "CREDIT" : "DEBIT",
      reportGroup: received ? "CURRENT_LIABILITIES" : "CURRENT_ASSETS",
      controlType: received ? "INTEREST_PAYABLE" : "INTEREST_RECEIVABLE",
    }),
    result = await account({
      type: received ? "OTHER_EXPENSE" : "OTHER_INCOME",
      normalSide: received ? "DEBIT" : "CREDIT",
      reportGroup: received ? "OTHER_EXPENSES" : "OTHER_INCOME",
    });
  const body = {
    name: prefix + " loan " + ++count,
    partyId: p,
    direction,
    startDate: period.start,
    maturityDate: period.end,
    agreedPrincipal: "1000.00",
    annualRate: "12.500000",
    agreement: "Reviewed synthetic agreement and manual accrual policy",
    principalAccountId: principal,
    interestAccountId: interest,
    interestResultAccountId: result,
    manualSchedule: [
      { dueDate: period.end, principal: "1000.00", interest: "12.50" },
    ],
    reason: "Synthetic loan agreement",
    ...patch,
  };
  return { ...(await register("CREATE", body)), body };
}
function loanBody(
  l: { id: string; body: { direction: string } },
  bank: string,
  patch: Record<string, unknown> = {},
) {
  const kind = String(patch.kind ?? "LOAN_DISBURSEMENT"),
    incoming =
      (l.body.direction === "RECEIVED" && kind === "LOAN_DISBURSEMENT") ||
      (l.body.direction === "ADVANCED" &&
        ["LOAN_REPAYMENT", "LOAN_INTEREST_SETTLEMENT"].includes(kind)),
    cash = [
      "LOAN_DISBURSEMENT",
      "LOAN_REPAYMENT",
      "LOAN_INTEREST_SETTLEMENT",
    ].includes(kind);
  return {
    kind,
    loanId: l.id,
    reference: prefix + "." + ++count,
    documentDate: period.start,
    postingDate: period.start,
    description: "Reviewed synthetic loan movement",
    evidence: "Loan agreement and movement evidence",
    amount: "100.00",
    currency: "PKR",
    toCashId: cash && incoming ? bank : null,
    fromCashId: cash && !incoming ? bank : null,
    reason: "Reviewed loan movement",
    ...patch,
  };
}
async function postLoan(body: Record<string, unknown>) {
  const d = await move("CREATE", body);
  await move("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post typed loan movement",
  });
  return movementDetail(people.owner, d.id);
}
it("agreement, descriptive rate and explicit manual plan create no principal, accrual or payment", async () => {
  const l = await loan(),
    d = await loanDetail(people.owner, l.id);
  expect(d.principal).toBe("0.00");
  expect(d.interest).toBe("0.00");
  expect(d.item.annualRate).toBe("12.500000");
  expect(await db.financeLoanEvent.count({ where: { loanId: l.id } })).toBe(0);
  expect(d.movements).toHaveLength(0);
  expect((await loans(people.owner, { q: l.body.name })).items[0].state).toBe(
    "UNFUNDED",
  );
});
it("received principal credits a liability and repayments reduce it without revenue or expense", async () => {
  const l = await loan(),
    bank = (await banks()).a,
    d = await postLoan(loanBody(l, bank.id));
  expect(
    d.item.entry!.lines.find((r) => r.accountId === l.body.principalAccountId)
      ?.credit,
  ).toBe("100.00");
  await postLoan(
    loanBody(l, bank.id, { kind: "LOAN_REPAYMENT", amount: "25.15" }),
  );
  const v = await loanDetail(people.owner, l.id);
  expect(v.principal).toBe("74.85");
  expect(v.interest).toBe("0.00");
  expect((await loans(people.owner, { q: l.body.name })).summary).toMatchObject(
    { receivedPrincipal: "74.85", advancedPrincipal: "0.00" },
  );
  expect(d.item.sourceSnapshot).toHaveProperty("loan.direction", "RECEIVED");
});
it("advanced principal debits a loan asset and received repayments clear that asset", async () => {
  const l = await loan("ADVANCED"),
    bank = (await banks()).a,
    d = await postLoan(loanBody(l, bank.id));
  expect(
    d.item.entry!.lines.find((r) => r.accountId === l.body.principalAccountId)
      ?.debit,
  ).toBe("100.00");
  expect(d.item.entry!.lines.find((r) => r.accountId === bank.gl)?.credit).toBe(
    "100.00",
  );
  await postLoan(
    loanBody(l, bank.id, { kind: "LOAN_REPAYMENT", amount: "10.01" }),
  );
  expect((await loans(people.owner, { q: l.body.name })).summary).toMatchObject(
    { receivedPrincipal: "0.00", advancedPrincipal: "89.99" },
  );
});
it("interest accrual and settlement are separate from principal in both directions", async () => {
  for (const direction of ["RECEIVED", "ADVANCED"]) {
    const l = await loan(direction),
      bank = (await banks()).a;
    await postLoan(loanBody(l, bank.id));
    const accrual = await postLoan(
      loanBody(l, bank.id, { kind: "LOAN_INTEREST_ACCRUAL", amount: "12.50" }),
    );
    expect(accrual.item.entry!.lines.some((r) => r.accountId === bank.gl)).toBe(
      false,
    );
    expect(
      accrual.item.entry!.lines.find(
        (r) => r.accountId === l.body.interestResultAccountId,
      )?.[direction === "RECEIVED" ? "debit" : "credit"],
    ).toBe("12.50");
    await postLoan(
      loanBody(l, bank.id, {
        kind: "LOAN_INTEREST_SETTLEMENT",
        amount: "5.01",
      }),
    );
    const v = await loanDetail(people.owner, l.id);
    expect(v.principal).toBe("100.00");
    expect(v.interest).toBe("7.49");
    const over = await move(
      "CREATE",
      loanBody(l, bank.id, {
        kind: "LOAN_INTEREST_SETTLEMENT",
        amount: "7.50",
      }),
    );
    await expect(
      move("POST", {
        id: over.id,
        expectedVersion: 1,
        reason: "Excess interest",
      }),
    ).rejects.toMatchObject({ code: "FINANCE_LOAN_CAPACITY" });
  }
});
it("dated caps reject overpayment before later scheduled consumption and competing distinct requests", async () => {
  const l = await loan(),
    bank = (await banks()).a;
  await postLoan(loanBody(l, bank.id));
  await postLoan(
    loanBody(l, bank.id, {
      kind: "LOAN_REPAYMENT",
      amount: "60.00",
      postingDate: day(2),
    }),
  );
  const back = await move(
    "CREATE",
    loanBody(l, bank.id, {
      kind: "LOAN_REPAYMENT",
      amount: "40.01",
      postingDate: day(1),
    }),
  );
  await expect(
    move("POST", {
      id: back.id,
      expectedVersion: 1,
      reason: "Backdated overuse",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_LOAN_CAPACITY" });
  const drafts = await Promise.all([
    move(
      "CREATE",
      loanBody(l, bank.id, {
        kind: "LOAN_REPAYMENT",
        amount: "30.00",
        postingDate: day(3),
      }),
    ),
    move(
      "CREATE",
      loanBody(l, bank.id, {
        kind: "LOAN_REPAYMENT",
        amount: "30.00",
        postingDate: day(3),
      }),
    ),
  ]);
  const results = await Promise.allSettled(
    drafts.map((d) =>
      move("POST", {
        id: d.id,
        expectedVersion: 1,
        reason: "Competing principal payment",
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await loanDetail(people.owner, l.id)).principal).toBe("10.00");
});
it("loan source reversal cannot remove consumed principal and opposite repayment restores it exactly", async () => {
  const l = await loan(),
    bank = (await banks()).a,
    funded = await postLoan(loanBody(l, bank.id)),
    paid = await postLoan(
      loanBody(l, bank.id, { kind: "LOAN_REPAYMENT", amount: "30.00" }),
    );
  await expect(
    move("REVERSE", {
      id: funded.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Cannot remove consumed funds",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_LOAN_CAPACITY" });
  const b = {
      id: paid.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Reverse principal payment",
    },
    key = crypto.randomUUID(),
    r = await move("REVERSE", b, key);
  expect(await move("REVERSE", b, key)).toEqual(r);
  expect((await loanDetail(people.owner, l.id)).principal).toBe("100.00");
  expect(
    (await movementDetail(people.owner, r.reversalId!)).item.entry!.lines.map(
      (x) => [x.accountId, x.debit, x.credit],
    ),
  ).toEqual(
    paid.item.entry!.lines.map((x) => [x.accountId, x.credit, x.debit]),
  );
});
it("posted agreement terms freeze, principal and interest must clear before archival", async () => {
  const l = await loan(),
    bank = (await banks()).a;
  await postLoan(loanBody(l, bank.id));
  await expect(
    register("UPDATE", {
      ...l.body,
      id: l.id,
      expectedVersion: 1,
      annualRate: "0.00",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_LOAN_TERMS_USED" });
  await expect(
    register("ARCHIVE", {
      id: l.id,
      expectedVersion: 1,
      reason: "Cannot hide outstanding",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_LOAN_OUTSTANDING" });
  await postLoan(loanBody(l, bank.id, { kind: "LOAN_REPAYMENT" }));
  expect((await loans(people.owner, { q: l.body.name })).items[0].state).toBe(
    "SETTLED",
  );
  await register("ARCHIVE", {
    id: l.id,
    expectedVersion: 1,
    reason: "Archive fully settled",
  });
  expect((await loanDetail(people.owner, l.id)).item.active).toBe(false);
});
it("reviewed noncash adjustments require approval and ordinary counter accounts, never a cash or revenue inference", async () => {
  const l = await loan(),
    bank = (await banks()).a,
    b = loanBody(l, bank.id, {
      kind: "LOAN_PRINCIPAL_INCREASE",
      counterAccountId: revenue,
      approvalEvidence: "Accountant-approved adjustment",
      amount: "12.15",
    }),
    d = await postLoan(b);
  expect((await loanDetail(people.owner, l.id)).principal).toBe("12.15");
  expect(
    (await cashRegister(people.owner, { q: d.item.reference })).total,
  ).toBe(0);
  await expect(
    move("CREATE", { ...b, approvalEvidence: null }),
  ).rejects.toThrow();
  const bad = await move("CREATE", { ...b, counterAccountId: bank.gl });
  await expect(
    move("POST", {
      id: bad.id,
      expectedVersion: 1,
      reason: "Protected cash bypass",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_APPROVAL_REQUIRED" });
});
it("agreed principal limit and inactive/wrong-direction mappings reject atomic posting", async () => {
  const l = await loan(),
    bank = (await banks()).a,
    over = await move("CREATE", loanBody(l, bank.id, { amount: "1000.01" }));
  await expect(
    move("POST", {
      id: over.id,
      expectedVersion: 1,
      reason: "Exceeds agreement",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_LOAN_LIMIT" });
  expect(
    await db.financeJournalEntry.count({ where: { movementId: over.id } }),
  ).toBe(0);
  const wrong = await move(
    "CREATE",
    loanBody(l, bank.id, { fromCashId: bank.id, toCashId: null }),
  );
  await expect(
    move("POST", {
      id: wrong.id,
      expectedVersion: 1,
      reason: "Wrong direction",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_INVALID_INPUT" });
});
it("loan create replay, source post replay and date-filtered balances remain exact", async () => {
  const l = await loan(),
    bank = (await banks()).a,
    d = await move("CREATE", loanBody(l, bank.id, { amount: "0.01" })),
    b = { id: d.id, expectedVersion: 1, reason: "Post exact paisa" },
    key = crypto.randomUUID();
  expect(await move("POST", b, key)).toEqual(await move("POST", b, key));
  expect(
    (await loans(people.owner, { q: l.body.name, asOf: period.start })).items[0]
      .principal,
  ).toBe("0.01");
  await expect(
    db.$executeRaw`UPDATE "FinanceLoanEvent" SET amount=amount+1 WHERE "loanId"=${l.id}::uuid`,
  ).rejects.toThrow();
});
it("unselected and lower roles cannot read agreements or mutate finance through this route", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(loans(people[who], { q: "secret" })).rejects.toMatchObject({
      status: 403,
    });
    expect((await loanRead(req(who))).status).toBe(403);
    expect(
      (
        await loanMutation(
          req(who, { reauth: { password }, unexpected: true }),
          "CREATE",
        )
      ).status,
    ).toBe(403);
  }
  const response = await loanRead(req());
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("restricted runtime reads register/events and checked commands, without raw writes, helpers or sequence access", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    const row = (
      await sql.query(
        `SELECT has_table_privilege(current_user,'"FinanceLoan"','SELECT') AS read,has_table_privilege(current_user,'"FinanceLoanEvent"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_loan_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_loan_capacity(uuid,text,date)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_loan_number','USAGE') AS number`,
      )
    ).rows[0];
    expect(row).toEqual({
      read: true,
      write: false,
      command: true,
      helper: false,
      number: false,
    });
  } finally {
    await sql.end();
  }
});
