import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
const pg = new EmbeddedPostgres({
  databaseDir: ".local/postgres",
  user: "encova",
  password: "local_only",
  port: 55432,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: (message) => console.error(String(message)),
});
if (!existsSync(".local/postgres/PG_VERSION")) await pg.initialise();
await pg.start();
for (const name of ["encova_dev", "encova_test", "encova_restore"]) {
  const c = pg.getPgClient();
  await c.connect();
  const result = await c.query("SELECT 1 FROM pg_database WHERE datname=$1", [
    name,
  ]);
  await c.end();
  if (!result.rowCount) await pg.createDatabase(name);
}
console.log(
  "Local PostgreSQL ready on 127.0.0.1:55432. Development, test and restore databases are separate.",
);
process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});
await new Promise(() => {});
