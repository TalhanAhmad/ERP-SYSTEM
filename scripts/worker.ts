import "dotenv/config";
import nodemailer from "nodemailer";
import { z } from "zod";
import { db } from "../src/server/db";
import { processOutbox } from "../src/server/jobs/outbox";
import { reconcileAttendance } from "../src/server/jobs/attendance";
import { workDate } from "../src/lib/dates";
const settings = z
  .object({
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive(),
    SMTP_FROM: z.email(),
  })
  .parse(process.env);
const transport = nodemailer.createTransport({
  host: settings.SMTP_HOST,
  port: settings.SMTP_PORT,
  secure: settings.SMTP_PORT === 465,
  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 60000,
  ...(process.env.SMTP_USER
    ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
    : {}),
});
const result = await processOutbox((job) =>
  transport.sendMail({
    from: settings.SMTP_FROM,
    to: job.recipient,
    subject: job.subject,
    text: job.text,
    messageId: `<${job.id}@encova-workspace.local>`,
  }),
);
for (const date of [workDate(new Date(Date.now() - 86400000)), workDate()])
  await reconcileAttendance(date);
await db.rateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
await db.idempotency.deleteMany({ where: { expiresAt: { lt: new Date() } } });
console.log(JSON.stringify(result));
await db.$disconnect();
