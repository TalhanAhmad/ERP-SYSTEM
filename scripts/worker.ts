import "dotenv/config";
import { db } from "../src/server/db";
import { scheduledPass } from "../src/server/jobs/scheduled";
console.log(
  JSON.stringify(await scheduledPass(undefined, process.env, "CLI", true)),
);
await db.$disconnect();
