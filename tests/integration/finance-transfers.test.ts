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
const { billCommand, billDetail } =
  await import("@/modules/finance/payables/service");
const { movementCommand, movementDetail, movements, cashRegister } =
  await import("@/modules/finance/treasury/service");
const { movementRead, movementMutation } =
  await import("@/modules/finance/treasury/http");
type Person = Awaited<ReturnType<typeof db.person.create>>;
const people: Record<string, Person> = {},
  cookies: Record<string, string> = {},
  prefix = "M20." + crypto.randomUUID().slice(0, 7).toUpperCase(),
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
}, 30000);
afterAll(async () => {
  await release();
  await db.person.updateMany({
    where: { id: { in: Object.values(people).map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});

async function posted(patch: Record<string, unknown> = {}) {
  const d = await command("CREATE", body(patch));
  await command("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Reviewed synthetic bill",
  });
  return billDetail(people.owner, d.id);
}

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
const transfer = (
  a: string,
  b: string,
  patch: Record<string, unknown> = {},
) => ({
  kind: "TRANSFER",
  reference: prefix + "." + ++count,
  documentDate: period.start,
  postingDate: period.start,
  description: "Synthetic company transfer",
  evidence: "Synthetic bank evidence",
  currency: "PKR",
  amount: "200.00",
  fromCashId: a,
  toCashId: b,
  reason: "Reviewed cash transfer",
  ...patch,
});
async function transferred(
  a: string,
  b: string,
  patch: Record<string, unknown> = {},
) {
  const d = await move("CREATE", transfer(a, b, patch));
  await move("POST", {
    id: d.id,
    expectedVersion: 1,
    reason: "Post both bank legs",
  });
  return movementDetail(people.owner, d.id);
}
const day = (n: number) =>
  new Date(new Date(period.start).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
it("denies unselected roots and lower roles before register, details or malformed mutation disclosure", async () => {
  for (const who of ["other", "hr", "lead", "member"]) {
    await expect(
      cashRegister(people[who], { invalid: true }),
    ).rejects.toMatchObject({ code: "FINANCE_FORBIDDEN" });
    await expect(movements(people[who])).rejects.toMatchObject({
      code: "FINANCE_FORBIDDEN",
    });
    expect((await movementRead(req(who), undefined, true)).status).toBe(403);
    expect(
      (await movementMutation(req(who, { invalid: true }), "CREATE")).status,
    ).toBe(403);
  }
});
it("posts one transfer as exactly two matching cash legs and preserved source snapshot", async () => {
  const { a, b } = await banks(),
    d = await transferred(a.id, b.id);
  expect(d.item).toMatchObject({
    state: "POSTED",
    version: 2,
    amount: "200.00",
  });
  expect(
    d.item.entry!.lines.map((l) => [l.accountId, l.debit, l.credit]),
  ).toEqual([
    [b.gl, "200.00", "0.00"],
    [a.gl, "0.00", "200.00"],
  ]);
  expect(d.item.sourceSnapshot).toHaveProperty("fromCash.name");
  expect(
    (await cashRegister(people.owner, { cashAccountId: a.id })).summary.closing,
  ).toBe("-200.00");
  expect(
    (await cashRegister(people.owner, { cashAccountId: b.id })).summary.closing,
  ).toBe("200.00");
});
it("internal transfers are excluded from external totals and hidden rows never falsify book balance", async () => {
  const { a, b } = await banks();
  await transferred(a.id, b.id);
  await posted({
    kind: "EXPENSE",
    payableAccountId: null,
    cashAccountId: a.id,
    postingDate: day(1),
    description: "External operating cost",
    lines: [line({ unitRate: "30" })],
  });
  const all = await cashRegister(people.owner, {
      cashAccountId: a.id,
      from: period.start,
      to: period.end,
    }),
    external = await cashRegister(people.owner, {
      cashAccountId: a.id,
      from: period.start,
      to: period.end,
      includeInternal: "NO",
    });
  expect(all.summary).toMatchObject({
    opening: "0.00",
    closing: "-230.00",
    externalIn: "0.00",
    externalOut: "30.00",
    internalIn: "0.00",
    internalOut: "200.00",
  });
  expect(external.summary).toEqual(all.summary);
  expect(all.total).toBe(2);
  expect(external.total).toBe(1);
  expect(external.items[0].balance).toBe("-230.00");
  const searched = await cashRegister(people.owner, {
    cashAccountId: a.id,
    q: "External",
  });
  expect(searched.items[0].balance).toBe("-230.00");
  expect(searched.summary.closing).toBe("-230.00");
});
it("opening balances and as-of views include dated transfers even when matching list excludes them", async () => {
  const { a, b } = await banks();
  await transferred(a.id, b.id);
  await transferred(b.id, a.id, {
    amount: "25",
    documentDate: day(2),
    postingDate: day(2),
  });
  const view = await cashRegister(people.owner, {
    cashAccountId: a.id,
    from: day(1),
    to: day(2),
    includeInternal: "NO",
  });
  expect(view.summary).toMatchObject({
    opening: "-200.00",
    closing: "-175.00",
    externalIn: "0.00",
    externalOut: "0.00",
    internalIn: "25.00",
  });
  expect(view.total).toBe(0);
  expect(
    (
      await cashRegister(people.owner, {
        cashAccountId: a.id,
        to: period.start,
      })
    ).summary.closing,
  ).toBe("-200.00");
});
it("dated reversal swaps original legs, retains history and stays internal in the cash register", async () => {
  const { a, b } = await banks(),
    d = await transferred(a.id, b.id),
    key = crypto.randomUUID(),
    input = {
      id: d.item.id,
      expectedVersion: 2,
      postingDate: day(1),
      reason: "Reverse incorrect bank transfer",
    };
  const r = await move("REVERSE", input, key);
  expect(await move("REVERSE", input, key)).toEqual(r);
  const original = await movementDetail(people.owner, d.item.id);
  expect(original.item.state).toBe("REVERSED");
  expect(
    original.item.reversedBy!.entry!.lines.map((l) => [
      l.accountId,
      l.debit,
      l.credit,
    ]),
  ).toEqual(d.item.entry!.lines.map((l) => [l.accountId, l.credit, l.debit]));
  const cash = await cashRegister(people.owner, {
    cashAccountId: a.id,
    includeInternal: "NO",
  });
  expect(cash.total).toBe(0);
  expect(cash.summary).toMatchObject({
    closing: "0.00",
    externalIn: "0.00",
    externalOut: "0.00",
    internalIn: "200.00",
    internalOut: "200.00",
  });
  await expect(move("REVERSE", input)).rejects.toMatchObject({
    code: "FINANCE_REVERSAL_INVALID",
  });
});
it("one permanent request key replays exact results while changed input and competing posts cannot duplicate GL", async () => {
  const { a, b } = await banks(),
    d = await move("CREATE", transfer(a.id, b.id)),
    key = crypto.randomUUID(),
    input = {
      id: d.id,
      expectedVersion: 1,
      reason: "Concurrent transfer posting",
    };
  const values = await Promise.all([
    move("POST", input, key),
    move("POST", input, key),
  ]);
  expect(values[0]).toEqual(values[1]);
  expect(
    await db.financeJournalEntry.count({ where: { movementId: d.id } }),
  ).toBe(1);
  await expect(
    move("POST", { ...input, reason: "Different reason" }, key),
  ).rejects.toMatchObject({ code: "FINANCE_IDEMPOTENCY_CONFLICT" });
  const second = await move("CREATE", transfer(a.id, b.id)),
    out = await Promise.allSettled([
      move("POST", { ...input, id: second.id }),
      move("POST", { ...input, id: second.id }),
    ]);
  expect(out.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("source versions protect draft edits/voids and posted financial fields remain immutable", async () => {
  const { a, b } = await banks(),
    draft = await move("CREATE", transfer(a.id, b.id));
  await move("UPDATE", {
    ...transfer(a.id, b.id, { amount: "1.01" }),
    id: draft.id,
    expectedVersion: 1,
  });
  await expect(
    move("VOID", { id: draft.id, expectedVersion: 1, reason: "Stale version" }),
  ).rejects.toMatchObject({ code: "FINANCE_STALE_VERSION" });
  await move("VOID", {
    id: draft.id,
    expectedVersion: 2,
    reason: "Void unposted transfer",
  });
  expect((await movementDetail(people.owner, draft.id)).item.state).toBe(
    "VOIDED",
  );
  const d = await transferred(a.id, b.id);
  await expect(
    db.$executeRaw`UPDATE "FinanceMovement" SET amount=amount+1,version=version+1 WHERE id=${d.item.id}::uuid`,
  ).rejects.toThrow("FINANCE_MOVEMENT_IMMUTABLE");
});
it("rejects same bank, wrong precision/currency and inactive mappings without partial journal", async () => {
  const { a, b } = await banks();
  for (const patch of [
    { toCashId: a.id },
    { currency: "USD" },
    { amount: "1.001" },
    { amount: 1 },
  ])
    await expect(move("CREATE", transfer(a.id, b.id, patch))).rejects.toThrow();
  await master("CASH_ARCHIVE", {
    id: b.id,
    expectedVersion: 1,
    reason: "Archive synthetic bank",
  });
  const d = await move("CREATE", transfer(a.id, b.id));
  await expect(
    move("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Inactive bank blocked",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_MOVEMENT_MAPPING" });
  expect((await movementDetail(people.owner, d.id)).item.entry).toBeNull();
});
it("rejects future dates, closed periods and reversal preceding original posting atomically", async () => {
  const { a, b } = await banks(),
    p = await newPeriod(true),
    d = await move(
      "CREATE",
      transfer(a.id, b.id, { documentDate: p.start, postingDate: p.start }),
    );
  await expect(
    move("POST", {
      id: d.id,
      expectedVersion: 1,
      reason: "Future transfer blocked",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_FUTURE_DATE" });
  const later = await transferred(a.id, b.id, {
    documentDate: day(2),
    postingDate: day(2),
  });
  await expect(
    move("REVERSE", {
      id: later.item.id,
      expectedVersion: 2,
      postingDate: period.start,
      reason: "Before original blocked",
    }),
  ).rejects.toMatchObject({ code: "FINANCE_REVERSAL_INVALID" });
});
it("retains exact upper-bound paisa amounts and per-bank historical rows after master archival", async () => {
  const { a, b } = await banks(),
    d = await transferred(a.id, b.id, { amount: "999999999999999999.99" });
  expect(d.item.amount).toBe("999999999999999999.99");
  await master("CASH_ARCHIVE", {
    id: b.id,
    expectedVersion: 1,
    reason: "Archive used bank",
  });
  expect(
    (await cashRegister(people.owner, { cashAccountId: b.id })).summary.closing,
  ).toBe("999999999999999999.99");
});
it("movement evidence retains a real source FK and posted-source removal is independently blocked", async () => {
  const { a, b } = await banks(),
    d = await transferred(a.id, b.id),
    { reserveFile } = await import("@/modules/finance/documents/files/service"),
    v = await proof();
  const storage = {
    signedUpload: async () => "https://synthetic-upload.example.test/evidence",
    put: async () => {},
    get: async () => new Uint8Array(),
    remove: async () => {},
  };
  const r = await reserveFile(
    v.actor,
    v.proof,
    {
      sourceType: "MOVEMENT",
      sourceId: d.item.id,
      fileName: "Transfer.pdf",
      mimeType: "application/pdf",
      byteSize: 8,
      sha256: "0".repeat(64),
      reason: "Record transfer evidence",
    },
    crypto.randomUUID(),
    storage,
  );
  expect(r.file.movementId).toBe(d.item.id);
  await expect(
    db.$executeRaw`UPDATE "FinanceFile" SET state='REMOVED',version=version+1 WHERE id=${r.file.id}::uuid`,
  ).rejects.toThrow("FINANCE_FILE_RETAINED");
});
it("runtime can read and execute checked transfer command but cannot write movements, emit GL or use its number sequence", async () => {
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query("SET ROLE encova_app");
    const r = await sql.query(
      `SELECT has_table_privilege(current_user,'"FinanceMovement"','SELECT') AS read,has_table_privilege(current_user,'"FinanceMovement"','INSERT') AS write,has_function_privilege(current_user,'encova_finance_movement_command(uuid,text,text,timestamptz,text,jsonb,text,uuid)','EXECUTE') AS command,has_function_privilege(current_user,'encova_finance_movement_lines(uuid)','EXECUTE') AS helper,has_sequence_privilege(current_user,'finance_movement_number','USAGE') AS number`,
    );
    expect(r.rows[0]).toEqual({
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
