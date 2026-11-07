import "dotenv/config";
import { db } from "../src/server/db";
import { processOutbox } from "../src/server/jobs/outbox";
import { emailSender } from "../src/server/jobs/email";
import { emailStatus } from "../src/lib/email-config";
import { reconcileAttendance } from "../src/server/jobs/attendance";
import { workDate } from "../src/lib/dates";
const mailStatus = emailStatus();
const result = {
  mailStatus,
  ...(mailStatus === "READY"
    ? await processOutbox(emailSender())
    : { claimed: 0 }),
};
for (const date of [workDate(new Date(Date.now() - 86400000)), workDate()])
  await reconcileAttendance(date);
await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
await db.idempotency.deleteMany({ where: { expiresAt: { lt: new Date() } } });
console.log(JSON.stringify(result));
await db.$disconnect();
