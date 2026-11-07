import "dotenv/config";
import { z } from "zod";
import { workDate } from "../src/lib/dates";
import { reconcileAttendance } from "../src/server/jobs/attendance";
import { db } from "../src/server/db";
const date = z.iso.date().parse(process.argv[2] ?? workDate());
console.log(JSON.stringify({ date, ...(await reconcileAttendance(date)) }));
await db.$disconnect();
