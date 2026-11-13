import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { AppError, invariant } from "@/server/errors";
import { requireFinanceEnabled, withFinanceAccess } from "../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../access/reauth";
import { taxSchemas, taxQuerySchema } from "./schemas";
export async function taxCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: keyof typeof taxSchemas,
  input: unknown,
  key: string | null,
  requestId = crypto.randomUUID(),
) {
  requireFinanceEnabled();
  invariant(
    key && key.length >= 8 && key.length <= 128,
    "IDEMPOTENCY_REQUIRED",
    "Provide an Idempotency-Key of 8–128 characters.",
    400,
  );
  const normalized = taxSchemas[action].parse(input),
    evidence = consumeFinanceProof(
      proof,
      actor.id,
      "tax:" + action + ":" + key,
    );
  try {
    const rows = await db.$queryRaw<
      { result: { id: string; code: string; active: boolean } }[]
    >`SELECT public.encova_finance_tax_command(${actor.id}::uuid,${evidence.provider},${evidence.sessionId},${evidence.verifiedAt}::timestamptz,${action},${JSON.stringify(normalized)}::jsonb,${key},${requestId}::uuid) AS result`;
    return rows[0].result;
  } catch (e) {
    const cause = (
      e as {
        meta?: {
          driverAdapterError?: { cause?: { originalMessage?: string } };
        };
      }
    ).meta?.driverAdapterError?.cause;
    const code = cause?.originalMessage;
    const errors: Record<string, string> = {
      FINANCE_FORBIDDEN:
        "Only the current Finance Owner can change tax policies.",
      FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
      FINANCE_DUPLICATE_TAX_CODE:
        "This code overlaps an existing effective-date version, including retired versions.",
      FINANCE_TAX_MAPPING:
        "Choose separate active input/output or withholding controls appropriate for this policy.",
      FINANCE_IDEMPOTENCY_CONFLICT: "This key was used for different input.",
      FINANCE_INVALID_INPUT: "Check the reviewed policy fields.",
      FINANCE_NOT_FOUND: "Tax policy unavailable.",
    };
    if (code && errors[code])
      throw new AppError(
        code,
        errors[code],
        code === "FINANCE_NOT_FOUND"
          ? 404
          : code === "FINANCE_FORBIDDEN"
            ? 403
            : 409,
      );
    throw e;
  }
}
export async function taxCodes(actor: Pick<Actor, "id">, input: unknown = {}) {
  return withFinanceAccess(actor, async (tx) => {
    const q = taxQuerySchema.parse(input);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    const where = {
      ...(q.kind !== "ALL" ? { kind: q.kind } : {}),
      ...(q.active !== "ALL" ? { active: q.active === "ACTIVE" } : {}),
      OR: [
        { code: { contains: q.q, mode: "insensitive" as const } },
        { name: { contains: q.q, mode: "insensitive" as const } },
      ],
    };
    const total = await tx.financeTaxCode.count({ where }),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages),
      items = await tx.financeTaxCode.findMany({
        where,
        orderBy: [{ code: "asc" }, { effectiveFrom: "desc" }, { id: "asc" }],
        take: 25,
        skip: (page - 1) * 25,
        include: {
          inputAccount: { select: { code: true, name: true } },
          outputAccount: { select: { code: true, name: true } },
        },
      }),
      settings = await tx.financeSettings.findFirst({
        select: { ownerId: true },
      });
    return {
      items: items.map((i) => ({
        ...i,
        rate: i.rate.toFixed(6),
        effectiveFrom: i.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: i.effectiveTo?.toISOString().slice(0, 10) ?? null,
      })),
      total,
      page,
      pages,
      filters: q,
      isOwner: settings?.ownerId === actor.id,
    };
  });
}
