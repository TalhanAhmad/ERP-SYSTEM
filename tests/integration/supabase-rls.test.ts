import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import pg from "pg";
import { readFile } from "node:fs/promises";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required.");
const owner = new pg.Client({ connectionString: url });
beforeAll(async () => {
  await owner.connect();
  await owner.query(
    `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;`,
  );
  await owner.query("GRANT USAGE ON SCHEMA public TO anon, authenticated");
  await owner.query(await readFile("supabase/setup.sql", "utf8"));
});
afterAll(async () => {
  await owner.end();
});
it("enables RLS on all application tables", async () => {
  const result = await owner.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' AND NOT rowsecurity",
  );
  expect(result.rows).toEqual([]);
});
it("denies anonymous and authenticated Data API roles direct business-record access", async () => {
  for (const role of ["anon", "authenticated"]) {
    await owner.query("BEGIN");
    try {
      await owner.query(`SET LOCAL ROLE ${role}`);
      await expect(
        owner.query('SELECT * FROM "Person" LIMIT 1'),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await owner.query("ROLLBACK");
    }
  }
});
it("keeps RLS default-deny even after an accidental read grant", async () => {
  await owner.query('GRANT SELECT ON "Person" TO authenticated');
  await owner.query("BEGIN");
  try {
    await owner.query("SET LOCAL ROLE authenticated");
    expect((await owner.query('SELECT * FROM "Person" LIMIT 1')).rows).toEqual(
      [],
    );
  } finally {
    await owner.query("ROLLBACK");
    await owner.query('REVOKE SELECT ON "Person" FROM authenticated');
  }
});
it("permits the restricted server role while denying it legacy password tables", async () => {
  await owner.query("BEGIN");
  try {
    await owner.query("SET LOCAL ROLE encova_app");
    await expect(
      owner.query('SELECT id FROM "Person" LIMIT 1'),
    ).resolves.toHaveProperty("rows");
    await expect(
      owner.query('SELECT id FROM "account" LIMIT 1'),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await owner.query("ROLLBACK");
  }
});
