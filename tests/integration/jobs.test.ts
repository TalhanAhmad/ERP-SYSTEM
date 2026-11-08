import "dotenv/config";
import { beforeEach, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required.");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { processOutbox } = await import("@/server/jobs/outbox");
beforeEach(async () => {
  await db.outbox.deleteMany();
});
afterAll(async () => {
  await db.$disconnect();
});
const mail = () =>
  db.outbox.create({
    data: {
      eventKey: crypto.randomUUID(),
      recipient: "synthetic@example.test",
      subject: "Synthetic email",
      text: "Fixture content",
    },
  });
it("competing workers deliver a claimed email only once", async () => {
  const record = await mail();
  let delivered = 0;
  await Promise.all(
    [1, 2].map(() =>
      processOutbox(async () => {
        delivered++;
      }, 1),
    ),
  );
  expect(delivered).toBe(1);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } }))
      .deliveredAt,
  ).toBeTruthy();
});
it("retains a failed email for retry rather than claiming delivery", async () => {
  const record = await mail();
  await processOutbox(async () => {
    throw new Error("Synthetic transport failure");
  }, 1);
  const pending = await db.outbox.findUniqueOrThrow({
    where: { id: record.id },
  });
  expect(pending.deliveredAt).toBeNull();
  expect(pending.lastError).toBe("SMTP_DELIVERY_FAILED");
  expect(pending.attempts).toBe(1);
  await db.outbox.update({
    where: { id: record.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await processOutbox(async () => {}, 1);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } }))
      .deliveredAt,
  ).toBeTruthy();
});
it("recovers an expired lease and ignores an active lease", async () => {
  const record = await mail();
  await db.$executeRaw`UPDATE "Outbox" SET "leaseUntil"=now()+interval '1 hour' WHERE id=${record.id}::uuid`;
  expect((await processOutbox(async () => {}, 1)).claimed).toBe(0);
  await db.outbox.update({
    where: { id: record.id },
    data: { leaseUntil: new Date(0) },
  });
  expect((await processOutbox(async () => {}, 1)).claimed).toBe(1);
});

it("executes a bounded serverless job pass with durable email processing", async () => {
  await mail();
  let sent = 0;
  const { scheduledPass } = await import("@/server/jobs/scheduled");
  const result = await scheduledPass(async () => {
    sent++;
  });
  expect(sent).toBe(1);
  expect(result.mailClaimed).toBe(1);
  expect(result.slice).toBeGreaterThanOrEqual(0);
  expect(result.attendanceUpdated).toBeGreaterThanOrEqual(0);
});
it("never claims canceled mail even after a lease expires", async () => {
  const record = await mail();
  await db.outbox.update({
    where: { id: record.id },
    data: { canceledAt: new Date(), leaseUntil: new Date(0) },
  });
  let sent = 0;
  expect(
    (
      await processOutbox(async () => {
        sent++;
      }, 1)
    ).claimed,
  ).toBe(0);
  expect(sent).toBe(0);
});
it("keeps queued mail untouched and attendance processing available without SMTP", async () => {
  const record = await mail();
  const { scheduledPass } = await import("@/server/jobs/scheduled");
  const result = await scheduledPass(undefined, {});
  expect(result.mailStatus).toBe("NOT_CONFIGURED");
  expect(result.mailClaimed).toBe(0);
  expect(result.attendanceUpdated).toBeGreaterThanOrEqual(0);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } })).attempts,
  ).toBe(0);
});
it("does not send queued email from a daily pass even when SMTP settings are present", async () => {
  const record = await mail();
  const { scheduledPass } = await import("@/server/jobs/scheduled");
  const result = await scheduledPass(
    undefined,
    {
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: 587,
      SMTP_FROM: "synthetic@example.test",
    },
    "CRON",
  );
  expect(result.mailStatus).toBe("READY");
  expect(result.mailClaimed).toBe(0);
  expect(
    (await db.outbox.findUniqueOrThrow({ where: { id: record.id } })).attempts,
  ).toBe(0);
});
