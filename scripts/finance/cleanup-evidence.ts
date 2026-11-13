import { z } from "zod";
import { privateOperator, operatorCredentials } from "./operator-context";
const schema = z
  .object({
    ...operatorCredentials,
    olderThanHours: z.number().int().min(1).max(87600),
  })
  .strict();
await privateOperator(schema, async (data, verified, verifyAgain) => {
  const { db } = await import("../../src/server/db"),
    { withFinanceAccess } =
      await import("../../src/modules/finance/access/policy"),
    { removeFile, cleanupRemovedFile } =
      await import("../../src/modules/finance/documents/files/service");
  const cutoff = new Date(Date.now() - data.olderThanHours * 3600000),
    candidates = await withFinanceAccess(verified.actor, (tx) =>
      tx.financeFile.findMany({
        where: {
          OR: [
            { state: "REMOVED", blobDeletedAt: null },
            {
              state: "RESERVED",
              createdAt: { lt: cutoff },
              OR: [
                { invoice: { state: "DRAFT" } },
                { bill: { state: "DRAFT" } },
                { customerDocument: { state: "DRAFT" } },
                { supplierDocument: { state: "DRAFT" } },
                { journalDraft: { state: "DRAFT" } },
              ],
            },
          ],
        },
        select: { id: true, state: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 10,
      }),
    );
  if (!process.argv.includes("--apply")) {
    console.log(
      `Dry run: ${candidates.length} abandoned draft/tombstone candidates (maximum ten). No files changed.`,
    );
    return;
  }
  let removed = 0,
    pending = 0;
  for (const file of candidates) {
    const fresh = await verifyAgain(),
      key = "evidence-cleanup:" + file.id;
    try {
      if (file.state === "REMOVED")
        await cleanupRemovedFile(
          fresh.actor,
          fresh.proof,
          file.id,
          data.reason,
          key,
        );
      else {
        const result = await removeFile(
          fresh.actor,
          fresh.proof,
          { id: file.id, reason: data.reason },
          key,
        );
        if (result.cleanupPending) {
          pending++;
          continue;
        }
      }
      removed++;
    } catch {
      pending++;
    }
  }
  console.log(
    `Evidence cleanup: ${removed} completed; ${pending} pending or source changed. Posted evidence retained.`,
  );
  await db.$disconnect();
});
