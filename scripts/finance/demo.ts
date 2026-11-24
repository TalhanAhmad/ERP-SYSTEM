import EmbeddedPostgres from "embedded-postgres";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  symlink,
  stat,
  realpath,
  chmod,
} from "node:fs/promises";
import { existsSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { isOwnedDemoProcess } from "./demo-process";
import { configureDemoDatabase } from "./demo-database";
import {
  demoManifestSchema,
  demoPaths,
  demoEnvironment,
  type DemoManifest,
} from "./demo-config";
async function port() {
  const s = createServer();
  await new Promise<void>((r, j) => {
    s.once("error", j);
    s.listen(0, "127.0.0.1", r);
  });
  const n = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return n;
}
const root = await realpath(process.cwd()),
  directory = path.join(root, ".local", "finance-demo"),
  manifest = path.join(directory, "manifest.json");
await mkdir(directory, { recursive: true, mode: 0o700 });
let m: DemoManifest;
if (existsSync(manifest)) {
  if (((await stat(manifest)).mode & 0o077) !== 0)
    throw Error("Demo manifest must be private (0600).");
  m = demoManifestSchema.parse(JSON.parse(await readFile(manifest, "utf8")));
  if (m.projectRoot !== root)
    throw Error("Demo manifest belongs to a different checkout.");
} else {
  const names = [
    ["Finance Demo Owner", "owner", "SUPER_ADMIN"],
    ["Selected Demo Admin", "selected", "SUPER_ADMIN"],
    ["Unselected Demo Admin", "unselected", "SUPER_ADMIN"],
    ["Demo HR", "hr", "HR_ADMIN"],
    ["Demo Team Lead", "lead", "TEAM_LEAD"],
    ["Demo Member", "member", "MEMBER"],
  ] as const;
  m = {
    version: 1,
    id: crypto.randomUUID(),
    projectRoot: root,
    databasePort: await port(),
    appPort: await port(),
    providerPort: await port(),
    databasePassword: randomBytes(24).toString("hex"),
    runtimePassword: randomBytes(24).toString("hex"),
    authSecret: randomBytes(32).toString("hex"),
    cronSecret: randomBytes(32).toString("hex"),
    createdAt: new Date().toISOString(),
    accounts: names.map(([name, key, role]) => ({
      name,
      email: `finance.${key}@example.test`,
      username: `finance.demo.${key}`,
      role,
      password: randomBytes(16).toString("base64url") + "9!",
    })),
  };
  await writeFile(manifest, JSON.stringify(m, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
}
const runtimePath = path.join(directory, "runtime.json");
if (existsSync(runtimePath)) {
  const running = JSON.parse(await readFile(runtimePath, "utf8"));
  if (running.id === m.id && isOwnedDemoProcess(root, running.pid)) {
    console.log(
      `Finance demo already running: http://localhost:${m.appPort}/login`,
    );
    process.exit(0);
  }
}
const paths = demoPaths(m);
await mkdir(paths.root, { recursive: true, mode: 0o700 });
await mkdir(paths.app, { recursive: true, mode: 0o700 });
// Copy source only: never .env, .local, .vercel or a production project link. Keep its build separate.
const files = execFileSync("git", ["ls-files", "--cached", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
for (const name of files) {
  if (
    name === ".env" ||
    name.startsWith(".local/") ||
    name.startsWith(".vercel/") ||
    (name.startsWith(".env") && name !== ".env.example")
  )
    throw Error("Private deployment files must not enter demo source.");
  const target = path.join(paths.app, name);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(root, name), target);
}
if (!existsSync(path.join(paths.app, "node_modules")))
  await symlink(
    path.join(root, "node_modules"),
    path.join(paths.app, "node_modules"),
    "dir",
  );
const logPath = path.join(paths.root, "setup.log");
await writeFile(logPath, "", { mode: 0o600 });
await chmod(logPath, 0o600);
function command(args: string[], operator = false) {
  const fd = openSync(logPath, "a", 0o600);
  try {
    execFileSync("pnpm", args, {
      cwd: paths.app,
      env: demoEnvironment(m, operator),
      stdio: ["ignore", fd, fd],
      timeout: 240000,
    });
  } catch {
    throw Error("Demo setup command failed; inspect the private setup log.");
  } finally {
    closeSync(fd);
  }
}
const local = new EmbeddedPostgres({
  databaseDir: paths.database,
  user: "encova",
  password: m.databasePassword,
  port: m.databasePort,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
let child: ReturnType<typeof spawn> | undefined,
  stopping = false,
  databaseStarted = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((r) => child!.once("exit", () => r())),
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (databaseStarted) await local.stop();
}
try {
  if (!existsSync(path.join(paths.database, "PG_VERSION")))
    await local.initialise();
  await local.start();
  databaseStarted = true;
  const sql = local.getPgClient();
  await sql.connect();
  try {
    if (
      !(
        await sql.query("SELECT 1 FROM pg_database WHERE datname='encova_test'")
      ).rowCount
    )
      await local.createDatabase("encova_test");
    await sql.query(
      "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF; END $$;",
    );
  } finally {
    await sql.end();
  }
  console.log(
    "Preparing the owned finance demo database and isolated application build…",
  );
  await command(["db:generate"], true);
  await command(["db:migrate:deploy"], true);
  await configureDemoDatabase(
    m,
    await readFile(path.join(root, "supabase/setup.sql"), "utf8"),
  );
  if (!existsSync(paths.fixture))
    await command(
      [
        "exec",
        "tsx",
        "--conditions=react-server",
        "scripts/finance/seed-demo.ts",
        manifest,
      ],
      true,
    );
  await command(["exec", "next", "build", "--webpack"]);
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(m.appPort),
    ],
    {
      cwd: paths.app,
      env: demoEnvironment(m),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on(
    "data",
    (data) =>
      void writeFile(path.join(paths.root, "server.log"), data, {
        flag: "a",
        mode: 0o600,
      }),
  );
  child.stderr?.on(
    "data",
    (data) =>
      void writeFile(path.join(paths.root, "server.log"), data, {
        flag: "a",
        mode: 0o600,
      }),
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw Error("Demo server exited before readiness.");
    try {
      if ((await fetch(`http://127.0.0.1:${m.appPort}/login`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw Error("Demo server did not become ready.");
  await writeFile(
    path.join(directory, "logins.json"),
    JSON.stringify(
      {
        url: `http://localhost:${m.appPort}/login`,
        note: "Initial synthetic credentials. Restart does not reset password changes.",
        accounts: m.accounts.map(({ email, password, role, name }) => ({
          name,
          email,
          password,
          role,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(directory, "runtime.json"),
    JSON.stringify(
      {
        pid: process.pid,
        id: m.id,
        url: `http://localhost:${m.appPort}`,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Finance demo ready: http://localhost:${m.appPort}/login`);
  console.log("Private demo logins: .local/finance-demo/logins.json");
  console.log(
    "Synthetic January2020 books only. Email and external file storage are not connected. Ctrl+C stops the demo and retains its database.",
  );
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  await new Promise<void>((r) => child!.once("exit", () => r()));
  await stop();
} catch (e) {
  await stop();
  console.error(e instanceof Error ? e.message : "Demo setup failed.");
  process.exitCode = 1;
}
