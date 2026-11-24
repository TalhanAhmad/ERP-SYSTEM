import { readFile, writeFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { demoManifestSchema, demoPaths, demoEnvironment } from "./demo-config";
const file = await realpath(process.argv[2] ?? ""),
  root = await realpath(process.env.ENCOVA_DEMO_ROOT ?? ""),
  info = await stat(file);
if (
  file !== path.join(root, ".local", "finance-demo", "manifest.json") ||
  (info.mode & 0o077) !== 0
)
  throw Error("Explicit private finance demo manifest required.");
const m = demoManifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
if (m.projectRoot !== root)
  throw Error("Demo manifest belongs to another workspace.");
const paths = demoPaths(m),
  expected = demoEnvironment(m, true);
if (
  process.env.DATABASE_URL !== expected.DATABASE_URL ||
  process.env.APP_URL !== expected.APP_URL ||
  process.env.VERCEL_ENV
)
  throw Error("Owned loopback demo environment required.");
const sql = new pg.Client({ connectionString: expected.DATABASE_URL });
await sql.connect();
try {
  if (
    (await realpath(
      (await sql.query("SHOW data_directory")).rows[0].data_directory,
    )) !== (await realpath(paths.database))
  )
    throw Error("Refuse an unowned demo database.");
  const { db } = await import("@/server/db");
  try {
    if ((await db.person.count()) || (await db.financeJournalEntry.count()))
      throw Error(
        "Refuse to seed over retained demo identities or financial history.",
      );
    const { betterAuth } = await import("better-auth"),
      { prismaAdapter } = await import("better-auth/adapters/prisma");
    const auth = betterAuth({
      database: prismaAdapter(db, { provider: "postgresql" }),
      baseURL: expected.APP_URL,
      secret: m.authSecret,
      emailAndPassword: { enabled: true },
      advanced: { cookiePrefix: "encova-finance-demo" },
    });
    await db.companySettings.upsert({
      where: { id: "workspace" },
      create: {
        id: "workspace",
        companyName: "Encova Finance Demo — synthetic",
        workweek: [1, 2, 3, 4, 5, 6],
        reportReminders: false,
      },
      update: {
        companyName: "Encova Finance Demo — synthetic",
        workweek: [1, 2, 3, 4, 5, 6],
        reportReminders: false,
      },
    });
    const people = [];
    for (const a of m.accounts) {
      const signed = await auth.api.signUpEmail({
        body: { name: a.name, email: a.email, password: a.password },
      });
      await db.user.update({
        where: { id: signed.user.id },
        data: { emailVerified: true },
      });
      people.push(
        await db.person.create({
          data: {
            authUserId: signed.user.id,
            ...(a.supabaseUserId ? { supabaseUserId: a.supabaseUserId } : {}),
            email: a.email,
            username: a.username,
            displayName: a.name,
            role: a.role,
            status: "ACTIVE",
          },
        }),
      );
    }
    const owner = m.accounts[0],
      session = await auth.api.signInEmail({
        body: { email: owner.email, password: owner.password },
        asResponse: true,
      }),
      cookie = session.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    const { verifyFinanceReauthentication } =
        await import("@/modules/finance/access/reauth"),
      { setupOwner, accessCommand } =
        await import("@/modules/finance/access/service");
    const verify = () =>
      verifyFinanceReauthentication(
        new Request(expected.APP_URL + "/api/v1/finance/status", {
          headers: { cookie, origin: expected.APP_URL },
        }),
        { password: owner.password },
      );
    let v = await verify();
    await setupOwner(
      v.actor,
      v.proof,
      owner.username,
      "Explicit synthetic isolated finance demo owner",
    );
    v = await verify();
    await accessCommand(
      v.actor,
      v.proof,
      "GRANT",
      {
        targetId: people[1].id,
        expectedVersion: (await db.financeSettings.findFirstOrThrow()).version,
        reason: "Selected synthetic demo administrator",
      },
      crypto.randomUUID(),
    );
    const { seedAccountingAcceptance } =
      await import("../../tests/fixtures/finance-acceptance");
    const fixture = await seedAccountingAcceptance(verify);
    const { profitLoss, balanceSheet } =
        await import("@/modules/finance/reports/statements/service"),
      { generalLedger, trialBalance } =
        await import("@/modules/finance/reports/service");
    const range = { from: "2020-01-01", to: "2020-01-31" },
      profit = await profitLoss(people[0], range),
      balance = await balanceSheet(people[0], { asOf: range.to }),
      bank = await generalLedger(people[0], {
        ...range,
        accountId: fixture.accounts.bank,
      }),
      trial = await trialBalance(people[0], range);
    if (
      profit.sections.netProfit !== "180000.00" ||
      balance.sections.totalAssets !== "785000.00" ||
      balance.sections.difference !== "0.00" ||
      bank.closingBalance !== "575000.00" ||
      (await db.financeJournalEntry.count()) !== 9
    )
      throw Error("Demo source acceptance did not reconcile.");
    await writeFile(
      paths.fixture,
      JSON.stringify(
        {
          kind: "ISOLATED_SYNTHETIC_DEMO",
          createdAt: new Date().toISOString(),
          fixture,
          profit: profit.sections,
          balance: balance.sections,
          bank: bank.closingBalance,
          trial: trial.companyTotals,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      "Synthetic demo seeded:9 sources; bank575000.00; profit180000.00; assets785000.00; balanced.",
    );
  } finally {
    await db.$disconnect();
  }
} finally {
  await sql.end();
}
