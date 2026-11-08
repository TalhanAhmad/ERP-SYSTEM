import "dotenv/config";
import { z } from "zod";
import { workDate } from "../src/lib/dates";
import {
  createAttendanceJob,
  runAttendanceJob,
} from "../src/server/jobs/monitoring";
import { db } from "../src/server/db";
const date = z.iso.date().parse(process.argv[2] ?? workDate());
const reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .parse(process.argv[3] ?? "Controlled CLI attendance reconciliation");
const job = await db.$transaction((tx) =>
  createAttendanceJob(tx, null, { workDate: date, reason }, "CLI"),
);
console.log(
  JSON.stringify(
    await runAttendanceJob(
      job.id,
      crypto.randomUUID(),
      null,
      { reason },
      "CLI",
    ),
  ),
);
await db.$disconnect();
