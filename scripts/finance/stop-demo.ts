import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { demoManifestSchema } from "./demo-config";
import { isOwnedDemoProcess } from "./demo-process";
const root = await realpath(process.cwd()),
  directory = path.join(root, ".local/finance-demo"),
  file = path.join(directory, "manifest.json");
if (((await stat(file)).mode & 0o077) !== 0)
  throw Error("Private demo manifest required.");
const manifest = demoManifestSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  ),
  runtime = JSON.parse(
    await readFile(path.join(directory, "runtime.json"), "utf8"),
  );
if (
  manifest.projectRoot !== root ||
  runtime.id !== manifest.id ||
  !isOwnedDemoProcess(root, runtime.pid)
)
  throw Error("No matching owned demo process. No process was signalled.");
process.kill(runtime.pid, "SIGINT");
for (let i = 0; i < 100; i++) {
  try {
    process.kill(runtime.pid, 0);
  } catch {
    console.log(
      "Owned finance demo stopped; its database and credentials are retained.",
    );
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 100));
}
throw Error("The demo is still shutting down. No forced kill was attempted.");
