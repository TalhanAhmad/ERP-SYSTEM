import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { TLSSocket } from "node:tls";
import { databaseOptions } from "../src/lib/database-options";
import { createClient } from "@supabase/supabase-js";
const source = process.env.RECOVERY_DATABASE_URL,
  target =
    process.env.RESTORE_DATABASE_URL ??
    "postgresql://encova:local_only@localhost:55432/encova_restore",
  supabaseUrl = process.env.SUPABASE_URL,
  secret = process.env.SUPABASE_SECRET_KEY,
  publishable = process.env.SUPABASE_PUBLISHABLE_KEY,
  ca = process.env.DATABASE_SSL_CA;
if (
  process.env.RECOVERY_ACK !== "encova-hosted-to-isolated-local" ||
  !source ||
  !supabaseUrl ||
  !secret ||
  !publishable ||
  !ca
)
  throw new Error(
    "Explicit hosted recovery acknowledgement and private configuration are required.",
  );
const s = new URL(source),
  t = new URL(target),
  project = new URL(supabaseUrl).hostname.split(".")[0];
if (
  !s.hostname.endsWith(".pooler.supabase.com") ||
  s.port !== "5432" ||
  !decodeURIComponent(s.username).endsWith("." + project) ||
  s.pathname !== "/postgres"
)
  throw new Error(
    "Source must be the selected Supabase project session connection.",
  );
if (
  !["127.0.0.1", "localhost"].includes(t.hostname) ||
  t.pathname !== "/encova_restore"
)
  throw new Error(
    "Restore destination must be isolated loopback encova_restore.",
  );
const root = path.resolve(
    ".local/recovery/hosted-" + new Date().toISOString().replaceAll(":", "-"),
  ),
  archive = path.join(root, "public.dump");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const caPath = path.join(root, "db-ca.pem");
fs.writeFileSync(caPath, ca, { mode: 0o600 });
const from = new pg.Client(databaseOptions(source, 1, ca)),
  to = new pg.Client(databaseOptions(target, 1)),
  storage = createClient(supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  publicStorage = createClient(supabaseUrl, publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  sourceBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "encova-private",
  restoreBucket = "encova-restore-" + randomUUID().slice(0, 12);
let bucketCreated = false,
  snapshotOpen = false;
const started = performance.now();
function execute(binary: string, args: string[], url: URL, remote: boolean) {
  const result = spawnSync(
    binary,
    [
      "--host",
      url.hostname,
      "--port",
      url.port || "5432",
      "--username",
      decodeURIComponent(url.username),
      "--dbname",
      url.pathname.slice(1),
      ...args,
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: remote ? "verify-full" : "disable",
        ...(remote ? { PGSSLROOTCERT: caPath } : {}),
      },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    fs.writeFileSync(
      path.join(root, "tool-error.log"),
      result.stderr || String(result.error ?? "Unknown tool failure"),
      { mode: 0o600 },
    );
    throw new Error(
      "Recovery client failed; inspect the private local tool-error.log.",
    );
  }
}
async function fingerprint(c: pg.Client) {
  const names = (
    await c.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const result = [];
  for (const { tablename } of names) {
    const quoted = '"' + tablename.replaceAll('"', '""') + '"',
      r = await c.query(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text),'')) AS digest FROM ${quoted} t`,
      );
    result.push({ table: tablename, ...r.rows[0] });
  }
  return result;
}
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function cleanupOwnedBucket() {
  if (!bucketCreated) return;
  if (
    !restoreBucket.startsWith("encova-restore-") ||
    restoreBucket === sourceBucket
  )
    throw new Error("Refusing to clean an unowned bucket.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const emptied = await storage.storage.emptyBucket(restoreBucket);
    const deleted = emptied.error
      ? emptied
      : await storage.storage.deleteBucket(restoreBucket);
    if (!deleted.error) {
      bucketCreated = false;
      return;
    }
    const current = await storage.storage.getBucket(restoreBucket);
    if (current.error && Number(current.error.status) === 404) {
      bucketCreated = false;
      return;
    }
    fs.writeFileSync(
      path.join(root, "cleanup-error.json"),
      JSON.stringify({
        bucket: restoreBucket,
        status: deleted.error.status,
        message: deleted.error.message,
      }),
      { mode: 0o600 },
    );
    if (attempt < 4)
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw new Error(
    "Owned recovery bucket needs cleanup; inspect its private receipt.",
  );
}
async function objectKeys() {
  const prefixes = [""],
    files: string[] = [];
  while (prefixes.length) {
    const prefix = prefixes.shift()!;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await storage.storage
        .from(sourceBucket)
        .list(prefix, {
          limit: 100,
          offset,
          sortBy: { column: "name", order: "asc" },
        });
      if (error || !data)
        throw new Error("Unable to list private source objects.");
      for (const o of data) {
        const key = prefix ? prefix + "/" + o.name : o.name;
        if (o.id) files.push(key);
        else prefixes.push(key);
      }
      if (files.length + prefixes.length > 10000)
        throw new Error(
          "Recovery rehearsal is bounded to 10,000 source objects.",
        );
      if (data.length < 100) break;
    }
  }
  return files.sort();
}
try {
  await from.connect();
  await to.connect();
  await from.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  snapshotOpen = true;
  // pg_stat_ssl describes the pooler's internal backend hop, not this client socket.
  const transport = (from as unknown as { connection: { stream: TLSSocket } })
    .connection.stream;
  if (!transport.encrypted || !transport.authorized)
    throw new Error(
      "Hosted snapshot must use certificate-verified TLS to the pooler.",
    );
  const snapshot = (await from.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id,
    before = await fingerprint(from),
    constraints = (
      await from.query(
        "SELECT count(*)::int AS count FROM pg_constraint WHERE connamespace='public'::regnamespace",
      )
    ).rows[0].count;
  execute(
    process.env.PG_DUMP_BIN ?? "pg_dump",
    [
      "--format=custom",
      "--compress=0",
      "--schema=public",
      "--snapshot",
      snapshot,
      "--no-owner",
      "--no-privileges",
      "--file",
      archive,
    ],
    s,
    true,
  );
  fs.chmodSync(archive, 0o600);
  // Roles here are NOLOGIN placeholders for restored policies, never provider credentials.
  await to.query(
    "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='encova_app') THEN CREATE ROLE encova_app NOLOGIN; END IF; END $$",
  );
  await to.query("DROP SCHEMA public CASCADE");
  execute(
    process.env.PG_RESTORE_BIN ?? "pg_restore",
    [
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--single-transaction",
      archive,
    ],
    t,
    false,
  );
  const after = await fingerprint(to);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error(
      "Restored hosted records do not match the exported snapshot.",
    );
  const restoredConstraints = (
    await to.query(
      "SELECT count(*)::int AS count FROM pg_constraint WHERE connamespace='public'::regnamespace",
    )
  ).rows[0].count;
  if (restoredConstraints !== constraints)
    throw new Error("Restored constraints do not match.");
  const evidenceDb = {
    tables: after.length,
    rows: after.reduce((n, r) => n + r.count, 0),
    constraints,
    snapshotMatches: true,
    backupSha256: hash(fs.readFileSync(archive)),
    tlsVerified: true,
  };
  const ready = (
    await from.query(
      `SELECT "storageKey",sha256 FROM "Attachment" WHERE status IN ('READY','ATTACHED')`,
    )
  ).rows;
  // The public ERP snapshot is read-only; Storage recovery uses a new isolated bucket.
  await from.query("COMMIT");
  snapshotOpen = false;
  const keys = await objectKeys(),
    manifest: {
      key: string;
      file: string;
      sha256: string;
      size: number;
      mime: string;
    }[] = [];
  let totalBytes = 0;
  fs.mkdirSync(path.join(root, "objects"), { mode: 0o700 });
  for (const key of keys) {
    const { data, error } = await storage.storage
      .from(sourceBucket)
      .download(key);
    if (error || !data)
      throw new Error(
        "Source object download failed; no source deletion is attempted.",
      );
    const bytes = Buffer.from(await data.arrayBuffer());
    totalBytes += bytes.length;
    if (totalBytes > 104857600)
      throw new Error("Recovery rehearsal is bounded to 100 MB.");
    const sha256 = hash(bytes),
      file = "objects/" + hash(Buffer.from(key));
    fs.writeFileSync(path.join(root, file), bytes, { mode: 0o600 });
    manifest.push({
      key,
      file,
      sha256,
      size: bytes.length,
      mime: data.type || "application/octet-stream",
    });
  }
  fs.writeFileSync(
    path.join(root, "storage-manifest.json"),
    JSON.stringify({ sourceBucket, objects: manifest }, null, 2),
    { mode: 0o600 },
  );
  if (manifest.length) {
    const created = await storage.storage.createBucket(restoreBucket, {
      public: false,
      fileSizeLimit: 4194304,
    });
    if (created.error)
      throw new Error("Cannot create isolated private restore bucket.");
    bucketCreated = true;
    fs.writeFileSync(
      path.join(root, "restore-bucket.json"),
      JSON.stringify({
        bucket: restoreBucket,
        sourceBucket,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    for (const object of manifest) {
      const bytes = fs.readFileSync(path.join(root, object.file));
      const put = await storage.storage
        .from(restoreBucket)
        .upload(object.key, bytes, { contentType: object.mime, upsert: false });
      if (put.error) throw new Error("Isolated object restore failed.");
      const back = await storage.storage
        .from(restoreBucket)
        .download(object.key);
      if (
        back.error ||
        !back.data ||
        hash(Buffer.from(await back.data.arrayBuffer())) !== object.sha256
      )
        throw new Error("Restored object checksum mismatch.");
    }
    const denied = await publicStorage.storage
      .from(restoreBucket)
      .download(manifest[0].key);
    if (!denied.error)
      throw new Error("Restored bucket unexpectedly allows anonymous access.");
  }
  let readyVerified = 0;
  for (const row of ready) {
    const object = manifest.find((o) => o.key === row.storageKey);
    if (!object || object.sha256 !== row.sha256)
      throw new Error(
        "An available attachment is missing or fails its stored digest.",
      );
    readyVerified++;
  }
  if (JSON.stringify(keys) !== JSON.stringify(await objectKeys()))
    throw new Error(
      "Source Storage changed during backup. Repeat the object pass.",
    );
  const evidence = {
    at: new Date().toISOString(),
    source: "hosted Encova public ERP schema and private bucket",
    destination:
      "isolated loopback encova_restore and newly created private test bucket",
    database: evidenceDb,
    storage: {
      objects: manifest.length,
      bytes: totalBytes,
      availableAttachmentsVerified: readyVerified,
      restoredHashesMatch: true,
      anonymousDenied: manifest.length > 0,
    },
    durationMs: Math.round(performance.now() - started),
    sourceErpSchemaWritten: false,
    sourceObjectsModified: false,
    testRestoreBucketCleaned: true,
    authSchemaIncluded: false,
    managedPitrTested: false,
    offsiteCopyCreated: false,
  };
  await cleanupOwnedBucket();
  fs.writeFileSync(
    path.join(root, "evidence.json"),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} finally {
  if (snapshotOpen) await from.query("ROLLBACK").catch(() => {});
  await cleanupOwnedBucket();
  await from.end();
  await to.end();
}
