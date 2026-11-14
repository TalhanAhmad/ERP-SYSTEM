import { z } from "zod";
import { privateOperator, operatorCredentials } from "./operator-context";
const schema = z
  .object({
    ...operatorCredentials,
    keyId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    signingSecretHex: z
      .string()
      .regex(/^[a-f0-9]{64,256}$/)
      .refine((v) => v.length % 2 === 0),
  })
  .strict();
await privateOperator(schema, async (data, verified) => {
  const { db } = await import("../../src/server/db"),
    { requireFinanceAccess } =
      await import("../../src/modules/finance/access/policy"),
    { consumeFinanceProof } =
      await import("../../src/modules/finance/access/reauth"),
    { AppError } = await import("../../src/server/errors");
  const evidence = consumeFinanceProof(
    verified.proof,
    verified.actor.id,
    "files:SCANNER_SETUP:" + data.keyId,
  );
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(987661)`;
    await requireFinanceAccess(tx, verified.actor);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(629815)`;
    const owner = await tx.financeSettings.findFirst({
      select: { ownerId: true },
    });
    if (owner?.ownerId !== verified.actor.id)
      throw new AppError(
        "FINANCE_FORBIDDEN",
        "Current Finance Owner required.",
        403,
      );
    const active = await tx.$queryRaw<
      { ok: boolean }[]
    >`SELECT encova_finance_session_ok(${verified.actor.id}::uuid,${evidence.provider},${evidence.sessionId}) AS ok`;
    if (!active[0]?.ok)
      throw new AppError(
        "FINANCE_REAUTH_REQUIRED",
        "Current verified session required.",
        403,
      );
    await tx.financeScanAuthority.create({
      data: {
        id: data.keyId,
        name: data.name,
        secret: Buffer.from(data.signingSecretHex, "hex"),
        createdById: verified.actor.id,
        reason: data.reason,
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        actorId: verified.actor.id,
        action: "FINANCE_SCANNER_AUTHORITY_CREATED",
        entityType: "FinanceScanAuthority",
        entityId: data.keyId,
        reason: data.reason,
        data: { keyId: data.keyId, name: data.name },
        requestId: crypto.randomUUID(),
      },
    });
  });
  console.log(
    "Approved scanner verification authority configured. No signing secret printed.",
  );
});
