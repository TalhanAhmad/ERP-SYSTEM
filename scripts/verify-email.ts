import "dotenv/config";
import { readFile } from "node:fs/promises";
import { verifyEmailTransport } from "../src/server/jobs/email";

// Optional local JSON avoids placing credentials in shell history or argv.
try {
  const input = process.argv[2]
    ? JSON.parse(await readFile(process.argv[2], "utf8"))
    : process.env;
  await verifyEmailTransport(input);
  console.log(
    "PASS: SMTP connection/authentication verified. No email was sent.",
  );
} catch {
  console.error(
    "FAIL: Check SMTP settings and credentials in the private configuration.",
  );
  process.exitCode = 1;
}
