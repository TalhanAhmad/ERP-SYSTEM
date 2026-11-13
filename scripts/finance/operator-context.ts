import "dotenv/config";
import { lstat, readFile, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { z } from "zod";
export const operatorCredentials = {
  cookie: z.string().min(1),
  password: z.string().min(1).max(128),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  reason: z.string().trim().min(3).max(500),
};
export async function privateOperator<T extends z.ZodType>(
  schema: T,
  work: (
    data: z.output<T>,
    session: Awaited<
      ReturnType<
        typeof import("../../src/modules/finance/access/reauth").verifyFinanceReauthentication
      >
    >,
    verifyAgain: () => ReturnType<
      typeof import("../../src/modules/finance/access/reauth").verifyFinanceReauthentication
    >,
  ) => Promise<void>,
) {
  let consumed: string | undefined,
    disconnect: (() => Promise<void>) | undefined;
  try {
    const path = resolve(
      z.string().min(1).parse(process.env.FINANCE_CREDENTIAL_FILE),
    );
    if (dirname(path) !== resolve(".local/finance"))
      throw Error("PRIVATE_FILE_REQUIRED");
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o600
    )
      throw Error("PRIVATE_FILE_PERMISSIONS");
    consumed = path;
    const data = schema.parse(JSON.parse(await readFile(path, "utf8"))),
      credentials = z.object(operatorCredentials).parse(data);
    const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
    if (
      !url ||
      (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname) &&
        !process.env.DIRECT_URL) ||
      (new URL(url).hostname.endsWith(".pooler.supabase.com") &&
        new URL(url).port === "6543")
    )
      throw Error("OPERATOR_CONNECTION_REQUIRED");
    process.env.DATABASE_URL = url;
    const { db } = await import("../../src/server/db"),
      { env } = await import("../../src/server/env"),
      { verifyFinanceReauthentication } =
        await import("../../src/modules/finance/access/reauth");
    disconnect = () => db.$disconnect();
    const verifyAgain = () =>
      verifyFinanceReauthentication(
        new Request(env.APP_URL + "/finance/attachments", {
          headers: { cookie: credentials.cookie },
        }),
        {
          password: credentials.password,
          ...(credentials.code ? { code: credentials.code } : {}),
        },
      );
    const session = await verifyAgain();
    await work(data, session, verifyAgain);
  } catch (e) {
    console.error(
      "Finance operator command rejected (" +
        (e && typeof e === "object" && "code" in e
          ? String(e.code)
          : "CONFIGURATION_OR_PERMISSION") +
        "). No credentials printed.",
    );
    process.exitCode = 1;
  } finally {
    if (consumed) await unlink(consumed);
    await disconnect?.();
  }
}
