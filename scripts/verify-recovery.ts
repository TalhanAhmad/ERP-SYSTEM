import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import pg from "pg";
const source =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
const target =
  process.env.RESTORE_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_restore";
for (const [url, name] of [
  [source, "encova_test"],
  [target, "encova_restore"],
]) {
  const p = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(p.hostname) ||
    p.pathname !== "/" + name
  )
    throw new Error(
      "Recovery verification requires separate loopback encova_test/encova_restore databases.",
    );
}
const dir = path.resolve(".local/recovery");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const backup = path.join(dir, "encova-test.dump"),
  sourceDb = new pg.Client({ connectionString: source }),
  targetDb = new pg.Client({ connectionString: target });
const started = performance.now();
function clientArgs(url: string) {
  const v = new URL(url);
  return {
    args: [
      "--host",
      v.hostname,
      "--port",
      v.port || "5432",
      "--username",
      decodeURIComponent(v.username),
      "--dbname",
      v.pathname.slice(1),
    ],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(v.password) },
  };
}
function execute(binary: string, args: string[], url: string) {
  const opts = clientArgs(url),
    r = spawnSync(binary, [...opts.args, ...args], {
      env: opts.env,
      encoding: "utf8",
    });
  if (r.status !== 0) {
    fs.writeFileSync(
      path.join(dir, "tool-error.log"),
      r.stderr || String(r.error ?? "Unknown recovery tool error"),
      { mode: 0o600 },
    );
    throw new Error(
      "PostgreSQL recovery tool failed; inspect private local recovery log.",
    );
  }
}
async function fingerprints(c: pg.Client) {
  const tables = (
    await c.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const result = [];
  for (const t of tables) {
    const quoted = '"' + t.tablename.replaceAll('"', '""') + '"',
      r = await c.query(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM ${quoted} t`,
      );
    result.push({ table: t.tablename, ...r.rows[0] });
  }
  return result;
}
try {
  await sourceDb.connect();
  await targetDb.connect();
  const before = await fingerprints(sourceDb);
  execute(
    process.env.PG_DUMP_BIN ?? "pg_dump",
    [
      "--format=custom",
      "--compress=0",
      "--no-owner",
      "--no-privileges",
      "--file",
      backup,
    ],
    source,
  );
  fs.chmodSync(backup, 0o600);
  // Only the explicitly isolated restore target may be reset.
  await targetDb.query("DROP SCHEMA public CASCADE");
  await targetDb.query("CREATE SCHEMA public");
  execute(
    process.env.PG_RESTORE_BIN ?? "pg_restore",
    ["--no-owner", "--no-privileges", "--exit-on-error", backup],
    target,
  );
  const after = await fingerprints(targetDb),
    sourceAfter = await fingerprints(sourceDb);
  if (JSON.stringify(before) !== JSON.stringify(sourceAfter))
    throw new Error(
      "Source changed during the recovery drill. Repeat while tests are stopped.",
    );
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Restored records do not match the source.");
  const constraints = (
    await targetDb.query(
      "SELECT count(*)::int AS count FROM pg_constraint WHERE connamespace='public'::regnamespace",
    )
  ).rows[0].count;
  const evidence = {
    at: new Date().toISOString(),
    source: "isolated encova_test",
    target: "isolated encova_restore",
    tables: after.length,
    rows: after.reduce((n, t) => n + t.count, 0),
    constraints,
    backupSha256: createHash("sha256")
      .update(fs.readFileSync(backup))
      .digest("hex"),
    durationMs: Math.round(performance.now() - started),
    dataMatches: true,
    productionTouched: false,
  };
  fs.writeFileSync(
    path.join(dir, "evidence.json"),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} finally {
  await sourceDb.end();
  await targetDb.end();
}
