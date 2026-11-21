import pg from "pg";
import { constraintExpression } from "./constraint-expression";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  chmod,
  access,
} from "node:fs/promises";
import path from "node:path";
type ObjectStore = {
  get: (key: string) => Promise<Uint8Array>;
  put: (key: string, bytes: Uint8Array) => Promise<void>;
};
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export async function financeFingerprints(sql: pg.Client) {
  const tables = (
    await sql.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const records = [];
  for (const { tablename } of tables) {
    const rows = await sql.query(
      `SELECT to_jsonb(t)::text AS row FROM public.${quote(tablename)} t ORDER BY to_jsonb(t)::text`,
    );
    records.push({
      table: tablename,
      rows: rows.rowCount,
      sha256: hash(rows.rows.map((r) => r.row).join("\n")),
    });
  }
  const catalog: Record<string, unknown> = {};
  for (const [name, query] of Object.entries({
    constraints:
      "SELECT c.conrelid::regclass::text AS relation,c.conname,c.contype,pg_get_constraintdef(c.oid) AS definition,c.convalidated FROM pg_constraint c WHERE c.connamespace='public'::regnamespace ORDER BY 1,2",
    functions:
      "SELECT p.oid::regprocedure::text AS signature,p.proowner::regrole::text AS owner,pg_get_functiondef(p.oid) AS definition,(SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.grantor::regrole::text,a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.grantor::regrole::text,a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) AS acl FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' ORDER BY 1",
    relations:
      "SELECT c.relname,c.relkind,c.relowner::regrole::text AS owner,c.relrowsecurity,c.relforcerowsecurity,(SELECT jsonb_agg(jsonb_build_array(coalesce(r.rolname,'PUBLIC'),a.grantor::regrole::text,a.privilege_type,a.is_grantable) ORDER BY coalesce(r.rolname,'PUBLIC'),a.grantor::regrole::text,a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::char ELSE 'r'::char END::\"char\",c.relowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee) AS acl FROM pg_class c WHERE c.relnamespace='public'::regnamespace ORDER BY 1",
    indexes:
      "SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2",
    columns:
      "SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_generated,generation_expression,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    triggers:
      "SELECT t.tgrelid::regclass::text AS relation,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY 1,2",
    indexState:
      "SELECT c.relname,i.indisvalid,i.indisready,i.indisunique,i.indisprimary,i.indisexclusion,i.indimmediate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace ORDER BY 1",
    enums:
      "SELECT t.typname,e.enumsortorder,e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace='public'::regnamespace ORDER BY 1,2",
    schemas:
      "SELECT n.nspname,n.nspowner::regrole::text AS owner,n.nspacl::text AS acl FROM pg_namespace n WHERE n.nspname='public'",
    policies:
      "SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2",
    defaults:
      "SELECT d.defaclrole::regrole::text AS role,d.defaclobjtype,d.defaclacl::text AS acl FROM pg_default_acl d WHERE d.defaclnamespace='public'::regnamespace ORDER BY 1,2",
  }))
    catalog[name] = (await sql.query(query)).rows;
  for (const c of catalog.constraints as {
    contype: string;
    definition: unknown;
  }[])
    if (c.contype === "c")
      c.definition = constraintExpression(
        String(c.definition).replace(/^CHECK\s*/i, ""),
      );
  const sequences = (
    await sql.query(
      "SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
    )
  ).rows;
  catalog.sequences = [];
  for (const { sequencename } of sequences) {
    (catalog.sequences as unknown[]).push({
      name: sequencename,
      ...(
        await sql.query(
          `SELECT last_value::text,is_called FROM public.${quote(sequencename)}`,
        )
      ).rows[0],
    });
  }
  return {
    records,
    catalog,
    sha256: hash(JSON.stringify({ records, catalog })),
  };
}
async function binary(tool: "pg_dump" | "pg_restore") {
  const configured =
    process.env[tool === "pg_dump" ? "PG_DUMP_BIN" : "PG_RESTORE_BIN"];
  if (configured) return configured;
  for (const file of [
    `.local/tools/postgresql-source/postgresql-17.9/src/bin/pg_dump/${tool}`,
    `/usr/lib/postgresql/18/bin/${tool}`,
    `/usr/lib/postgresql/17/bin/${tool}`,
  ]) {
    try {
      await access(file);
      return path.resolve(file);
    } catch {}
  }
  return tool;
}
/** Test/operator drill only. Requires the actual data_directory of a caller-owned, disposable cluster. */
export async function restoreOwnedFinance(
  source: string,
  ownedDirectory: string,
  stores?: { source: ObjectStore; restored: ObjectStore },
) {
  const url = new URL(source);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/encova_test"
  )
    throw Error("Recovery requires loopback encova_test.");
  const root = await realpath(".local/finance"),
    owned = await realpath(ownedDirectory);
  if (
    !owned.startsWith(root + path.sep) ||
    !/(?:acceptance|opening|closing-browser|recovery)-[a-f0-9-]{36}$/.test(
      owned,
    )
  )
    throw Error("Explicit disposable owned finance cluster required.");
  const sql = new pg.Client({ connectionString: source });
  await sql.connect();
  const backupDirectory = path.resolve(
      `.local/recovery/finance/${crypto.randomUUID()}`,
    ),
    targetName = "encova_restore_" + crypto.randomUUID().replaceAll("-", "");
  let restored: pg.Client | undefined;
  try {
    const actual = await realpath(
      (await sql.query("SHOW data_directory")).rows[0].data_directory,
    );
    if (actual !== owned)
      throw Error("Source cluster does not match the owned directory.");
    const before = await financeFingerprints(sql);
    if (
      !(await sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"'))
        .rows[0].n
    )
      throw Error("Populated finance journals required for recovery.");
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const objects = (
      await sql.query(
        'SELECT id,"objectKey","byteSize",sha256 FROM "FinanceFile" WHERE "blobDeletedAt" IS NULL AND state IN (\'CLEAN\',\'QUARANTINED\') ORDER BY id',
      )
    ).rows;
    if (objects.length && !stores)
      throw Error(
        "Separate evidence object backup and restore stores required.",
      );
    for (const object of objects) {
      const bytes = await stores!.source.get(object.objectKey);
      if (bytes.length !== object.byteSize || hash(bytes) !== object.sha256)
        throw Error("Source evidence object checksum mismatch.");
      await writeFile(
        path.join(backupDirectory, object.id + ".object"),
        bytes,
        { mode: 0o600 },
      );
    }
    const args = [
      "--host",
      url.hostname,
      "--port",
      url.port || "5432",
      "--username",
      decodeURIComponent(url.username),
    ];
    const childEnv = {
      ...process.env,
      PGPASSWORD: decodeURIComponent(url.password),
    };
    const execute = async (tool: "pg_dump" | "pg_restore", extra: string[]) => {
      try {
        execFileSync(await binary(tool), [...args, ...extra], {
          env: childEnv,
          stdio: "pipe",
          timeout: 120000,
        });
      } catch {
        throw Error(
          "PostgreSQL owned recovery tool failed; verify matching pg_dump/pg_restore17+ availability.",
        );
      }
    };
    const dump = path.join(backupDirectory, "finance.dump");
    // Preserve all grants/revokes, security definers, policies and private BYTEA. Never --no-privileges.
    await execute("pg_dump", [
      "--dbname",
      "encova_test",
      "--format=custom",
      "--compress=0",
      "--no-owner",
      "--file",
      dump,
    ]);
    await chmod(dump, 0o600);
    // Newly generated database only. No existing target schema/database is dropped or reset.
    await sql.query(`CREATE DATABASE ${quote(targetName)}`);
    await execute("pg_restore", [
      "--dbname",
      targetName,
      "--no-owner",
      "--exit-on-error",
      dump,
    ]);
    const restoredUrl = new URL(source);
    restoredUrl.pathname = "/" + targetName;
    restored = new pg.Client({ connectionString: restoredUrl.toString() });
    await restored.connect();
    const after = await financeFingerprints(restored),
      sourceAfter = await financeFingerprints(sql);
    if (before.sha256 !== sourceAfter.sha256)
      throw Error(
        "Source changed during recovery; require a quiescent snapshot.",
      );
    await writeFile(
      path.join(backupDirectory, "comparison.json"),
      JSON.stringify({ before, after }),
      { mode: 0o600 },
    );
    if (before.sha256 !== after.sha256)
      throw Error(
        "Restored records, constraints, functions, RLS, ACLs or sequences differ.",
      );
    for (const object of objects) {
      const bytes = await readFile(
        path.join(backupDirectory, object.id + ".object"),
      );
      await stores!.restored.put(object.objectKey, bytes);
      if (hash(await stores!.restored.get(object.objectKey)) !== object.sha256)
        throw Error("Restored evidence checksum mismatch.");
    }
    const totals = (
      await restored.query(
        'SELECT sum(debit)::text AS debit,sum(credit)::text AS credit FROM "FinanceJournalLine"',
      )
    ).rows[0];
    if (totals.debit !== totals.credit)
      throw Error("Restored ledger is not balanced.");
    const evidence = {
      kind: "OWNED_SYNTHETIC_RECOVERY",
      at: new Date().toISOString(),
      tables: after.records.length,
      rows: after.records.reduce((n, t) => n + (t.rows ?? 0), 0),
      catalogHash: after.sha256,
      backupHash: hash(await readFile(dump)),
      objectCount: objects.length,
      totals,
      sourceUnchanged: true,
      aclPreserved: true,
      productionTouched: false,
    };
    await writeFile(
      path.join(backupDirectory, "evidence.json"),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 },
    );
    return {
      evidence,
      targetUrl: restoredUrl.toString(),
      directory: backupDirectory,
    };
  } finally {
    await restored?.end();
    await sql.end();
  }
}
