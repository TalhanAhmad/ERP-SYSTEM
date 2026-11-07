import "dotenv/config";
import { env } from "../src/server/env";
import { db } from "../src/server/db";
import { supabaseAdmin } from "../src/server/supabase/client";
import { Client } from "pg";
import { TLSSocket } from "node:tls";
import { databaseOptions } from "../src/lib/database-options";
if (env.AUTH_PROVIDER !== "supabase")
  throw new Error("Supabase must be selected for deployment verification.");
const settings = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
  headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY! },
  signal: AbortSignal.timeout(10000),
});
if (!settings.ok || (await settings.json()).disable_signup !== true)
  throw new Error(
    "Disable public registration in Supabase Auth before rollout.",
  );
const roles = await db.$queryRaw<
  { rolsuper: boolean; rolbypassrls: boolean }[]
>`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
if (roles[0]?.rolsuper || roles[0]?.rolbypassrls)
  throw new Error(
    "Use the restricted encova_app runtime connection, not a database administrator.",
  );
const unprotected = await db.$queryRaw<
  { tablename: string }[]
>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' AND NOT rowsecurity`;
if (unprotected.length)
  throw new Error(
    "Apply supabase/setup.sql: some application tables lack RLS.",
  );
const bucket = await supabaseAdmin().storage.getBucket(
  env.SUPABASE_STORAGE_BUCKET,
);
if (bucket.error || !bucket.data || bucket.data.public)
  throw new Error(
    "The private storage bucket must exist and must not be public.",
  );
// Supavisor terminates client TLS; pg_stat_ssl describes the different
// pooler-to-database connection. Verify our actual client socket instead.
const client = new Client(
  databaseOptions(env.DATABASE_URL, 1, env.DATABASE_SSL_CA),
);
try {
  await client.connect();
  const socket = client.connection.stream;
  if (!(socket instanceof TLSSocket) || !socket.encrypted || !socket.authorized)
    throw new Error("The hosted runtime connection requires verified TLS.");
} finally {
  await client.end();
}
console.log(
  "PASS: Supabase registration, runtime role, RLS, private bucket and TLS configuration. Live login, file workflows, scheduler and restore checks remain separate.",
);
await db.$disconnect();
