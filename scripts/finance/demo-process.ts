import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
/** Never signal a PID from a stale manifest unless both command and working directory match. */
export function isOwnedDemoProcess(root: string, pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
    return false;
  try {
    const command = execFileSync(
      "ps",
      ["-ww", "-p", String(pid), "-o", "args="],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (
      !command.endsWith("scripts/finance/demo.ts") ||
      !command.includes("--conditions=react-server")
    )
      return false;
    let cwd: string;
    if (process.platform === "linux") cwd = realpathSync(`/proc/${pid}/cwd`);
    else if (process.platform === "darwin") {
      const output = execFileSync(
        "lsof",
        ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const value = output
        .split("\n")
        .find((line) => line.startsWith("n"))
        ?.slice(1);
      if (!value) return false;
      cwd = realpathSync(value);
    } else return false;
    return cwd === realpathSync(root);
  } catch {
    return false;
  }
}
