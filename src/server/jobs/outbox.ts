import "server-only";
import { db } from "../db";
type Email = { recipient: string; subject: string; text: string; id: string };
export async function processOutbox(
  send: (mail: Email) => Promise<unknown>,
  limit = 20,
) {
  let claimed = 0;
  for (let n = 0; n < limit; n++) {
    const job = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "Outbox" WHERE "deliveredAt" IS NULL AND attempts<5 AND "nextAttemptAt"<=now() AND ("leaseUntil" IS NULL OR "leaseUntil"<now()) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      const id = rows[0].id;
      await tx.$executeRaw`UPDATE "Outbox" SET attempts=attempts+1,"leaseUntil"=date_trunc('milliseconds',now())+interval '5 minutes' WHERE id=${id}::uuid`;
      return tx.outbox.findUniqueOrThrow({ where: { id } });
    });
    if (!job) break;
    claimed++;
    try {
      await send(job);
      await db.outbox.updateMany({
        where: { id: job.id, leaseUntil: job.leaseUntil },
        data: { deliveredAt: new Date(), leaseUntil: null, lastError: null },
      });
    } catch {
      await db.outbox.updateMany({
        where: { id: job.id, leaseUntil: job.leaseUntil },
        data: {
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + 60000 * 2 ** job.attempts),
          lastError: "SMTP_DELIVERY_FAILED",
        },
      });
    }
  }
  return { claimed };
}
