import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { AppError, invariant } from "@/server/errors";
import {
  requireFinanceEnabled,
  financeStatus,
  withFinanceAccess,
} from "../../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../../access/reauth";
import {
  bankMatchSchemas,
  bankMatchPreviewSchema,
  bankMatchOptionsSchema,
  bankMatchQuerySchema,
  type BankMatchAction,
} from "./schemas";
import { bankMatchErrors } from "./errors";
export type MatchSource = {
  kind: "STATEMENT" | "CASH";
  id: string;
  date: string;
  direction: "RECEIPT" | "PAYMENT";
  amount: string;
  description: string;
  number?: string;
  reference?: string;
  batchId?: string;
  journalId?: string;
  sourceType?: string;
  sourceId?: string;
};
export type MatchPosition = {
  source: MatchSource;
  allocated: string;
  remaining: string;
  eventDigest: string;
};
export type MatchPreview = {
  basisHash: string;
  cashAccountId: string;
  glAccountId: string;
  currency: "PKR";
  earliestDate: string;
  latestDate: string;
  receipts: string;
  payments: string;
  allocations: {
    sequence: number;
    statementLineId: string;
    journalLineId: string;
    amount: string;
    effectiveDate: string;
    statement: MatchPosition;
    cash: MatchPosition;
  }[];
};
const errors: Record<string, string> = {
  ...bankMatchErrors,
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_NOT_FOUND: "Bank match unavailable.",
  FINANCE_INVALID_INPUT:
    "Check the matching fields and exact positive amounts.",
  FINANCE_STALE_VERSION: "This match changed. Reload before continuing.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This request key was used for different matching input.",
  FINANCE_DUPLICATE: "This matching operation was already recorded.",
  FINANCE_ACCOUNT_UNAVAILABLE:
    "Choose an active PKR bank account with its active original cash mapping.",
  FINANCE_BANK_MATCH_SOURCE:
    "Choose imported statement records and actual posted cash entries for the same bank, currency and direction.",
  FINANCE_BANK_MATCH_CAPACITY:
    "Proposed allocations exceed the available amount on a statement record or cash entry. Review both sides.",
  FINANCE_BANK_MATCH_DUPLICATE:
    "Combine repeated allocations to the same statement/cash pair.",
  FINANCE_BANK_MATCH_STALE:
    "Matching history changed. Review a new preview before confirming.",
  FINANCE_BANK_MATCH_IMMUTABLE:
    "Matching history is retained. Undo an active match and review a new group to correct it.",
  FINANCE_PERIOD_UNAVAILABLE:
    "Every match date must be in an open accounting period. Reopen the period before correcting a historical association.",
  FINANCE_FUTURE_DATE:
    "The bank value date and cash posting date must both have arrived (Pakistan time).",
};
function databaseError(e: unknown): never {
  const code = (
    e as {
      meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } };
    }
  )?.meta?.driverAdapterError?.cause?.originalMessage;
  if (code && errors[code])
    throw new AppError(
      code,
      errors[code],
      code === "FINANCE_NOT_FOUND"
        ? 404
        : ["FINANCE_FORBIDDEN", "FINANCE_REAUTH_REQUIRED"].includes(code)
          ? 403
          : code === "FINANCE_INVALID_INPUT"
            ? 422
            : 409,
    );
  throw new AppError(
    "FINANCE_BANK_MATCH_UNAVAILABLE",
    "Matching is unavailable. Retry with the same request key.",
    503,
  );
}
const lock = async (tx: Prisma.TransactionClient) => {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
};
export async function bankMatchPreview(
  actor: Pick<Actor, "id">,
  input: unknown,
) {
  return withFinanceAccess(actor, async (tx) => {
    const body = bankMatchPreviewSchema.parse(input);
    await lock(tx);
    try {
      return (
        await tx.$queryRaw<
          { data: MatchPreview }[]
        >`SELECT public.encova_finance_bank_match_preview(${actor.id}::uuid,${JSON.stringify(body)}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      return databaseError(e);
    }
  });
}
export async function bankMatchOptions(
  actor: Pick<Actor, "id">,
  input: unknown,
) {
  return withFinanceAccess(actor, async (tx) => {
    const body = bankMatchOptionsSchema.parse(input);
    await lock(tx);
    try {
      return (
        await tx.$queryRaw<
          {
            data: {
              items: MatchPosition[];
              page: number;
              pages: number;
              total: number;
            };
          }[]
        >`SELECT public.encova_finance_bank_match_options(${actor.id}::uuid,${JSON.stringify(body)}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      return databaseError(e);
    }
  });
}
export async function bankMatchCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: BankMatchAction,
  input: unknown,
  key: string | null,
  requestId = crypto.randomUUID(),
) {
  requireFinanceEnabled();
  await financeStatus(actor);
  invariant(
    key && key.length >= 8 && key.length <= 128,
    "IDEMPOTENCY_REQUIRED",
    "Provide an Idempotency-Key of 8–128 characters.",
    400,
  );
  const { id, ...body } = z.record(z.string(), z.unknown()).parse(input);
  invariant(
    action !== "MATCH" || id === undefined,
    "VALIDATION",
    "New match IDs are generated by the server.",
    422,
  );
  const normalized = {
      ...bankMatchSchemas[action].parse(body),
      ...(action === "UNMATCH" ? { id: z.uuid().parse(id) } : {}),
    },
    evidence = consumeFinanceProof(
      proof,
      actor.id,
      "bank-matches:" + action + ":" + key,
    );
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (
        await db.$queryRaw<
          {
            data: {
              id: string;
              number: string;
              version: number;
              state: string;
            };
          }[]
        >`SELECT public.encova_finance_bank_match_command(${actor.id}::uuid,${evidence.provider},${evidence.sessionId},${evidence.verifiedAt}::timestamptz,${action},${JSON.stringify(normalized)}::jsonb,${key},${requestId}::uuid) AS data`
      )[0].data;
    } catch (e) {
      const code = (
        e as {
          meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
        }
      )?.meta?.driverAdapterError?.cause?.originalCode;
      if (["40001", "40P01"].includes(code ?? "") && attempt < 2) continue;
      databaseError(e);
    }
  }
  throw new AppError(
    "CONCURRENT_CHANGE",
    "Concurrent matching change; retry.",
    409,
  );
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const select = {
  id: true,
  number: true,
  cashAccountId: true,
  glAccountId: true,
  description: true,
  evidence: true,
  earliestDate: true,
  latestDate: true,
  state: true,
  version: true,
  createdAt: true,
  createdBy: { select: { displayName: true } },
  unmatchedAt: true,
  unmatchedBy: { select: { displayName: true } },
  unmatchReason: true,
  cashAccount: { select: { name: true, maskedReference: true } },
  glAccount: { select: { code: true, name: true } },
} as const;
export async function bankMatches(
  actor: Pick<Actor, "id">,
  input: unknown = {},
) {
  return withFinanceAccess(actor, async (tx) => {
    const q = bankMatchQuerySchema.parse(input);
    await lock(tx);
    const where: Prisma.FinanceBankMatchWhereInput = {
        state: q.state === "ALL" ? { in: ["MATCHED", "UNMATCHED"] } : q.state,
        ...(q.cashAccountId ? { cashAccountId: q.cashAccountId } : {}),
        OR: [
          { number: { contains: q.q, mode: "insensitive" } },
          { description: { contains: q.q, mode: "insensitive" } },
          { cashAccount: { name: { contains: q.q, mode: "insensitive" } } },
        ],
      },
      total = await tx.financeBankMatch.count({ where }),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages),
      items = await tx.financeBankMatch.findMany({
        where,
        select,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 25,
        skip: (page - 1) * 25,
      });
    return {
      items: items.map((m) => ({
        ...m,
        earliestDate: day(m.earliestDate),
        latestDate: day(m.latestDate),
      })),
      total,
      page,
      pages,
      filters: q,
    };
  });
}
export async function bankMatchDetail(
  actor: Pick<Actor, "id">,
  id: string,
  input: unknown = {},
) {
  return withFinanceAccess(actor, async (tx) => {
    z.uuid().parse(id);
    const q = z
      .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .strict()
      .parse(input);
    await lock(tx);
    const item = await tx.financeBankMatch.findUnique({
      where: { id },
      select,
    });
    invariant(
      item && item.state !== "DRAFT",
      "FINANCE_NOT_FOUND",
      "Bank match unavailable.",
      404,
    );
    const total = await tx.financeBankMatchAllocation.count({
        where: { matchId: id },
      }),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages),
      allocations = await tx.financeBankMatchAllocation.findMany({
        where: { matchId: id },
        orderBy: { sequence: "asc" },
        take: 25,
        skip: (page - 1) * 25,
        include: {
          events: {
            select: {
              id: true,
              kind: true,
              delta: true,
              effectiveDate: true,
              createdAt: true,
              reason: true,
              createdBy: { select: { displayName: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      history = await tx.financeAuditEvent.findMany({
        where: { entityType: "FinanceBankMatch", entityId: id },
        select: {
          id: true,
          action: true,
          reason: true,
          createdAt: true,
          actor: { select: { displayName: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 50,
      });
    return {
      item: {
        ...item,
        earliestDate: day(item.earliestDate),
        latestDate: day(item.latestDate),
      },
      allocations: allocations.map((a) => ({
        ...a,
        amount: a.amount.toFixed(2),
        effectiveDate: day(a.effectiveDate),
        source: a.sourceSnapshot as {
          statement: MatchSource;
          cash: MatchSource;
        },
        events: a.events.map((e) => ({
          ...e,
          delta: e.delta.toFixed(2),
          effectiveDate: day(e.effectiveDate),
        })),
      })),
      page,
      pages,
      total,
      history,
    };
  });
}
