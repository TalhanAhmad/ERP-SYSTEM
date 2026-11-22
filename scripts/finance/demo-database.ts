import { realpath } from "node:fs/promises";
import pg from "pg";
import { demoEnvironment, demoPaths, type DemoManifest } from "./demo-config";
/** Operator-only setup. Check the real server directory before changing any privileges. */
export async function configureDemoDatabase(m: DemoManifest, setupSql: string) {
  const sql = new pg.Client({
    connectionString: demoEnvironment(m, true).DATABASE_URL,
  });
  await sql.connect();
  try {
    const actual = await realpath(
      (await sql.query("SHOW data_directory")).rows[0].data_directory,
    );
    if (actual !== (await realpath(demoPaths(m).database)))
      throw Error("Refuse an unowned finance demo database.");
    await sql.query(setupSql);
    await sql.query(
      `ALTER ROLE encova_app LOGIN PASSWORD '${m.runtimePassword}'`,
    );
    // Local Better Auth compatibility only. This never changes hosted setup.sql.
    for (const table of [
      "user",
      "session",
      "account",
      "verification",
      "auth_rate_limit",
    ]) {
      await sql.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON public."${table}" TO encova_app`,
      );
      await sql.query(
        `DROP POLICY IF EXISTS encova_local_demo_auth ON public."${table}"`,
      );
      await sql.query(
        `CREATE POLICY encova_local_demo_auth ON public."${table}" TO encova_app USING(true) WITH CHECK(true)`,
      );
    }
  } finally {
    await sql.end();
  }
}
