import "dotenv/config";
import pg from "pg";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).pathname !== "/encova_test" ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  process.env.NODE_ENV === "production"
)
  throw new Error(
    "Reset only supports an explicitly supplied local encova_test database.",
  );
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query("DROP SCHEMA public CASCADE");
await client.query("CREATE SCHEMA public");
await client.end();
console.log("Dedicated synthetic test schema reset. Apply migrations next.");
