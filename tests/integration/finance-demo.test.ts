import { beforeAll, afterAll, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {
  demoEnvironment,
  demoPaths,
  type DemoManifest,
} from "../../scripts/finance/demo-config";
import { configureDemoDatabase } from "../../scripts/finance/demo-database";
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
const workspace = await realpath(process.cwd()),
  root = path.join(workspace, ".local/finance-demo-tests", crypto.randomUUID());
const roles = [
  "SUPER_ADMIN",
  "SUPER_ADMIN",
  "SUPER_ADMIN",
  "HR_ADMIN",
  "TEAM_LEAD",
  "MEMBER",
] as const;
const m: DemoManifest = {
  version: 1,
  id: crypto.randomUUID(),
  projectRoot: root,
  databasePort: await freePort(),
  appPort: await freePort(),
  providerPort: await freePort(),
  databasePassword: randomBytes(24).toString("hex"),
  runtimePassword: randomBytes(24).toString("hex"),
  authSecret: randomBytes(32).toString("hex"),
  cronSecret: randomBytes(32).toString("hex"),
  createdAt: new Date().toISOString(),
  accounts: roles.map((role, n) => ({
    name: "Owned demo actor " + n,
    email: `owned.demo${n}@example.test`,
    username: "owned.demo." + n,
    role,
    password: randomBytes(16).toString("base64url") + "9!",
  })),
};
const paths = demoPaths(m),
  manifest = path.join(root, ".local/finance-demo/manifest.json"),
  env = demoEnvironment(m, true);
const local = new EmbeddedPostgres({
  databaseDir: paths.database,
  user: "encova",
  password: m.databasePassword,
  port: m.databasePort,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
const sql = new pg.Client({ connectionString: env.DATABASE_URL });
beforeAll(async () => {
  await mkdir(path.dirname(manifest), { recursive: true, mode: 0o700 });
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await writeFile(manifest, JSON.stringify(m), { mode: 0o600 });
  await local.initialise();
  await local.start();
  await local.createDatabase("encova_test");
  await sql.connect();
  await sql.query(
    "CREATE ROLE anon NOLOGIN NOINHERIT;CREATE ROLE authenticated NOLOGIN NOINHERIT;",
  );
  execFileSync("pnpm", ["db:migrate:deploy"], {
    cwd: workspace,
    env,
    stdio: "pipe",
    timeout: 90000,
  });
  await configureDemoDatabase(m, await readFile("supabase/setup.sql", "utf8"));
}, 120000);
afterAll(async () => {
  await sql.end();
  await local.stop();
  await rm(root, { recursive: true, force: true });
}, 30000);
it("fresh private initialization uses real local verification, creates exactly nine balanced sources and six distinct role identities", async () => {
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--conditions=react-server",
      "scripts/finance/seed-demo.ts",
      manifest,
    ],
    { cwd: workspace, env, encoding: "utf8", timeout: 90000 },
  );
  if (run.status !== 0)
    await writeFile(
      path.join(root, "seed-error.log"),
      (run.stdout ?? "") + (run.stderr ?? ""),
      { mode: 0o600 },
    );
  expect(
    run.status,
    "Owned demo initialization must complete through actual checked application services.",
  ).toBe(0);
  const evidence = JSON.parse(await readFile(paths.fixture, "utf8"));
  expect(evidence).toMatchObject({
    kind: "ISOLATED_SYNTHETIC_DEMO",
    bank: "575000.00",
    profit: { netProfit: "180000.00" },
    balance: { totalAssets: "785000.00", difference: "0.00" },
  });
  expect(
    (await sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"'))
      .rows[0].n,
  ).toBe(9);
  expect(
    (await sql.query('SELECT count(*)::int AS n FROM "Person"')).rows[0].n,
  ).toBe(6);
  expect(
    (
      await sql.query(
        'SELECT count(*)::int AS n FROM "FinanceGrant" WHERE "revokedAt" IS NULL',
      )
    ).rows[0].n,
  ).toBe(2);
}, 120000);
it("a second seed refuses existing books rather than deleting, duplicating or replacing them", async () => {
  const before = (
    await sql.query(
      'SELECT id,reference FROM "FinanceJournalEntry" ORDER BY id',
    )
  ).rows;
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--conditions=react-server",
      "scripts/finance/seed-demo.ts",
      manifest,
    ],
    { cwd: workspace, env, encoding: "utf8", timeout: 30000 },
  );
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain(
    "Refuse to seed over retained demo identities or financial history.",
  );
  expect(
    (
      await sql.query(
        'SELECT id,reference FROM "FinanceJournalEntry" ORDER BY id',
      )
    ).rows,
  ).toEqual(before);
});
it("local compatibility grants permit login while raw financial writes, cores and browser-role access remain denied", async () => {
  const c = new pg.Client({
    connectionString: demoEnvironment(m).DATABASE_URL,
  });
  await c.connect();
  try {
    expect(
      (
        await c.query(
          `SELECT current_user,has_table_privilege(current_user,'public.user','SELECT') AS auth_read,has_table_privilege(current_user,'"FinanceJournalLine"','INSERT,UPDATE,DELETE') AS financial_write,has_function_privilege(current_user,'encova_finance_bill_core(uuid,text,jsonb,text,uuid)','EXECUTE') AS raw`,
        )
      ).rows[0],
    ).toEqual({
      current_user: "encova_app",
      auth_read: true,
      financial_write: false,
      raw: false,
    });
    for (const role of ["anon", "authenticated"])
      expect(
        (
          await c.query(
            "SELECT has_table_privilege($1,'public.user','SELECT') AS auth_read,has_table_privilege($1,'\"FinanceJournalLine\"','SELECT') AS finance_read",
            [role],
          )
        ).rows[0],
      ).toEqual({ auth_read: false, finance_read: false });
  } finally {
    await c.end();
  }
});
it("a directory mismatch rejects setup before widening any existing database privileges", async () => {
  const wrong = { ...m, id: crypto.randomUUID() };
  await mkdir(demoPaths(wrong).database, { recursive: true, mode: 0o700 });
  await expect(
    configureDemoDatabase(
      wrong,
      "GRANT ALL ON ALL TABLES IN SCHEMA public TO encova_app;",
    ),
  ).rejects.toThrow("Refuse an unowned finance demo database.");
  expect(
    (
      await sql.query(
        `SELECT has_table_privilege('encova_app','"FinanceJournalLine"','UPDATE') AS write`,
      )
    ).rows[0].write,
  ).toBe(false);
});
