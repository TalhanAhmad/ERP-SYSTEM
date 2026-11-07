import "dotenv/config";
const address = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!address) throw new Error("Configure the migration database connection.");
let target: URL;
try {
  target = new URL(address);
} catch {
  throw new Error(
    "The migration connection URL is invalid; credentials are not printed.",
  );
}
if (
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname) &&
  !process.env.DIRECT_URL
)
  throw new Error(
    "Hosted migrations require DIRECT_URL from the controlled migration environment. Do not migrate through the runtime transaction pooler.",
  );
if (target.hostname.endsWith(".pooler.supabase.com") && target.port === "6543")
  throw new Error(
    "Use the Supabase direct/session connection for migrations, not transaction port 6543.",
  );
console.log("Migration connection policy verified; no credentials printed.");
