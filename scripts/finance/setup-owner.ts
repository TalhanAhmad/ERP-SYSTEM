import "dotenv/config";
import { lstat, readFile, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { z } from "zod";

// Run only with a controlled migration/operator connection; never use a public
// bootstrap route or replace provider credentials through the Admin API.
let consumedFile: string | undefined;
let disconnect: (() => Promise<void>) | undefined;
try {
  const config = z
    .object({
      FINANCE_OWNER_ID: z.uuid(),
      FINANCE_OWNER_USERNAME: z.string().regex(/^[a-z0-9._-]{3,30}$/),
      FINANCE_OPERATOR_ACK: z.enum([
        "BOOTSTRAP_EXPLICIT_OWNER",
        "RECOVER_IDENTITY_VERIFIED",
      ]),
      FINANCE_OPERATOR_EVIDENCE: z.string().trim().min(10).max(500).optional(),
      FINANCE_CREDENTIAL_FILE: z.string().min(1),
    })
    .parse(process.env);
  const path = resolve(config.FINANCE_CREDENTIAL_FILE);
  if (dirname(path) !== resolve(".local/finance"))
    throw new Error("PRIVATE_FILE_REQUIRED");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600)
    throw new Error("PRIVATE_FILE_PERMISSIONS");
  consumedFile = path;
  const privateInput = z
    .object({
      cookie: z.string().min(1),
      password: z.string().min(1).max(128),
      code: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
      reason: z.string().trim().min(3).max(500),
    })
    .strict()
    .parse(JSON.parse(await readFile(path, "utf8")));
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_CONNECTION_REQUIRED");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname) &&
    !process.env.DIRECT_URL
  )
    throw new Error("MIGRATION_CONNECTION_REQUIRED");
  if (
    new URL(url).hostname.endsWith(".pooler.supabase.com") &&
    new URL(url).port === "6543"
  )
    throw new Error("MIGRATION_CONNECTION_REQUIRED");
  process.env.DATABASE_URL = url;
  const { env } = await import("../../src/server/env");
  const { db } = await import("../../src/server/db");
  disconnect = () => db.$disconnect();
  const { verifyFinanceReauthentication } =
    await import("../../src/modules/finance/access/reauth");
  const { setupOwner } =
    await import("../../src/modules/finance/access/service");
  const verified = await verifyFinanceReauthentication(
    new Request(env.APP_URL + "/finance/access", {
      headers: { cookie: privateInput.cookie },
    }),
    {
      password: privateInput.password,
      ...(privateInput.code ? { code: privateInput.code } : {}),
    },
  );
  if (verified.actor.id !== config.FINANCE_OWNER_ID)
    throw new Error("OWNER_ID_MISMATCH");
  const recovery = config.FINANCE_OPERATOR_ACK === "RECOVER_IDENTITY_VERIFIED";
  if (recovery && !config.FINANCE_OPERATOR_EVIDENCE)
    throw new Error("IDENTITY_EVIDENCE_REQUIRED");
  await setupOwner(
    verified.actor,
    verified.proof,
    config.FINANCE_OWNER_USERNAME,
    privateInput.reason,
    recovery ? config.FINANCE_OPERATOR_EVIDENCE! : null,
  );
  console.log(
    recovery
      ? "Finance ownership recovered and prior owner access revoked. Evidence recorded."
      : "Explicit Finance Owner initialized atomically. No accounting data imported.",
  );
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "SETUP_REJECTED";
  console.error(
    `Finance owner command failed (${code}); no credentials printed. Review the runbook.`,
  );
  process.exitCode = 1;
} finally {
  if (consumedFile) await unlink(consumedFile);
  // Loaded dynamically: avoid opening any database connection for bad file/config.
  await disconnect?.();
}
