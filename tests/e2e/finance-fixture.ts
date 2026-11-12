import type { Page } from "@playwright/test";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { login } from "./helpers";
export async function financeFixture(
  page: Page,
  base: string,
  username: string,
) {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://encova:local_only@localhost:55432/encova_test";
  if (new URL(url).pathname !== "/encova_test")
    throw new Error("Dedicated test database required");
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const owner = (
    await sql.query(
      'SELECT id,username,"authUserId" FROM "Person" WHERE username=$1',
      [username],
    )
  ).rows[0];
  const password = "Synthetic-browser-test-only-9#";
  const cleanup = async () => {
    const current = (await sql.query('SELECT "ownerId" FROM "FinanceSettings"'))
      .rows[0];
    if (current && current.ownerId !== owner.id)
      throw new Error("Refuse unowned finance fixture cleanup");
    if (current) await sql.query('TRUNCATE "FinanceSettings"');
    await sql.query('DELETE FROM "FinanceGrant" WHERE "userId"=$1', [owner.id]);
  };
  try {
    await cleanup();
    await login(page, username + "@example.test");
    await mkdir(".local/finance", { recursive: true });
    const file = resolve(`.local/finance/browser-${crypto.randomUUID()}.json`);
    await writeFile(
      file,
      JSON.stringify({
        cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
        password,
        reason: "Explicit isolated browser fixture owner",
      }),
      { mode: 0o600 },
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--conditions=react-server",
        "scripts/finance/setup-owner.ts",
      ],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          DATABASE_URL: url,
          DIRECT_URL: url,
          APP_URL: base,
          BETTER_AUTH_URL: base,
          AUTH_PROVIDER: "better-auth",
          FINANCE_ENABLED: "true",
          FINANCE_OWNER_ID: owner.id,
          FINANCE_OWNER_USERNAME: username,
          FINANCE_OPERATOR_ACK: "BOOTSTRAP_EXPLICIT_OWNER",
          FINANCE_CREDENTIAL_FILE: file,
        },
      },
    );
  } catch (e) {
    await sql.end();
    throw e;
  }
  const create = async (path: string, body: Record<string, unknown>) => {
    const response = await page.request.post("/api/v1/finance/" + path, {
      headers: {
        Origin: base,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { ...body, reauth: { password } },
    });
    const json = await response.json();
    if (!response.ok())
      throw new Error("Fixture configuration failed: " + json.error.code);
    return json.data as { id: string; version: number };
  };
  const accountBody = (code: string, patch: Record<string, unknown> = {}) => ({
    code,
    name: code + " synthetic",
    type: "ASSET",
    normalSide: "DEBIT",
    reportGroup: "CURRENT_ASSETS",
    controlType: "NONE",
    currency: "PKR",
    parentId: null,
    isPosting: true,
    isContra: false,
    isCashEquivalent: false,
    reason: "Isolated browser mapping",
    ...patch,
  });
  const seedAccount = async (
    code: string,
    patch: Record<string, unknown> = {},
  ) => {
    // Operator-only fixture seed, never a production/public API or proof bypass.
    const session = (
      await sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [owner.authUserId],
      )
    ).rows[0];
    return (
      await sql.query(
        "SELECT encova_finance_setup_command($1,'better-auth',$2,CURRENT_TIMESTAMP,'ACCOUNT_CREATE',$3::jsonb,$4,$5) AS result",
        [
          owner.id,
          session.id,
          JSON.stringify(accountBody(code, patch)),
          crypto.randomUUID(),
          crypto.randomUUID(),
        ],
      )
    ).rows[0].result as { id: string; version: number };
  };
  const historicalPeriod = async (name: string) => {
    const candidate = (
      await sql.query(
        `SELECT d::date::text AS start FROM generate_series(DATE '1900-01-01',DATE '1950-01-01',interval '10 days') d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" p WHERE p.state<>'VOID' AND daterange(p."startDate",p."endDate",'[]') && daterange(d::date,(d+interval '9 days')::date,'[]')) ORDER BY d LIMIT 1`,
      )
    ).rows[0];
    if (!candidate) throw new Error("No isolated test interval");
    const start = String(candidate.start),
      end = new Date(new Date(String(candidate.start) + "T00:00:00Z").getTime() + 9 * 86400000)
        .toISOString()
        .slice(0, 10);
    return {
      ...(await create("periods", {
        name,
        startDate: start,
        endDate: end,
        reason: "Synthetic historical fixture only",
      })),
      start,
      end,
    };
  };
  return {
    sql,
    owner,
    password,
    create,
    accountBody,
    seedAccount,
    historicalPeriod,
    close: async () => {
      try {
        await cleanup();
      } finally {
        await sql.end();
      }
    },
  };
}
