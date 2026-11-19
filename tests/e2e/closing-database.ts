import EmbeddedPostgres from "embedded-postgres";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import type { Browser } from "@playwright/test";
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
export async function closingDatabase(browser: Browser) {
  const port = await freePort(),
    httpPort = await freePort(),
    directory = `.local/finance/closing-browser-${crypto.randomUUID()}`,
    url = `postgresql://encova:local_only@localhost:${port}/encova_test`,
    base = `http://localhost:${httpPort}`;
  const local = new EmbeddedPostgres({
    databaseDir: directory,
    user: "encova",
    password: "local_only",
    port,
    persistent: true,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await local.initialise();
  await local.start();
  await local.createDatabase("encova_test");
  const fixtureEnv = {
    ...process.env,
    DATABASE_URL: url,
    DIRECT_URL: url,
    TEST_DATABASE_URL: url,
    APP_URL: base,
    BETTER_AUTH_URL: base,
    AUTH_PROVIDER: "better-auth",
    FINANCE_ENABLED: "true",
    VERCEL_ENV: "",
  };
  let child: ReturnType<typeof spawn> | undefined;
  const context = await browser.newContext({ baseURL: base });
  const stop = async () => {
    await context.close();
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((r) => child!.once("exit", () => r())),
        new Promise<void>((r) => setTimeout(r, 5000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await local.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    execFileSync("pnpm", ["db:migrate:deploy"], {
      env: fixtureEnv,
      stdio: "pipe",
      timeout: 90000,
    });
    execFileSync("pnpm", ["test:e2e:prepare"], {
      env: fixtureEnv,
      stdio: "pipe",
      timeout: 90000,
    });
    child = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "--port", String(httpPort)],
      { env: fixtureEnv, stdio: "ignore" },
    );
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null)
        throw new Error("Owned close browser server exited before readiness");
      try {
        if ((await fetch(base + "/login")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready)
      throw new Error("Owned close browser server did not become ready");
    return { base, url, env: fixtureEnv, context, close: stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
