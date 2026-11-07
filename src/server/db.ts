import "server-only";
import { env } from "./env";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseOptions } from "@/lib/database-options";
const globalDb = globalThis as unknown as { db?: PrismaClient };
// Bound connections per function instance; use Supavisor transaction pooling on Vercel.
export const db =
  globalDb.db ??
  new PrismaClient({
    adapter: new PrismaPg(
      databaseOptions(
        env.DATABASE_URL,
        env.DATABASE_POOL_MAX,
        env.DATABASE_SSL_CA,
      ),
    ),
  });
globalDb.db = db;
