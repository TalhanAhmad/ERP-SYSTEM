import "server-only";
import { env } from "./env";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const globalDb = globalThis as unknown as { db?: PrismaClient };
// Bound connections per function instance; use Supavisor transaction pooling on Vercel.
export const db =
  globalDb.db ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000,
    }),
  });
globalDb.db = db;
