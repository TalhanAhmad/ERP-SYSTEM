import "server-only";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { AppError, invariant } from "@/server/errors";
import {
  requireFinanceEnabled,
  financeStatus,
  withFinanceAccess,
} from "../../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../../access/reauth";
import type { ReportMetadata } from "../service";
import {
  cashFlowQuerySchema,
  cashFlowReviewQuerySchema,
  cashFlowConfirmSchema,
} from "./schemas";
const messages: Record<string, string> = {
  FINANCE_CASH_FLOW_INCOMPLETE:
    "Every actual cash leg needs a complete reviewed split.",
  FINANCE_CASH_FLOW_TOTAL:
    "Components must equal each actual posted cash amount.",
  FINANCE_CASH_FLOW_INTERNAL:
    "Internal cash transfers must net to zero and stay outside external flows.",
  FINANCE_CASH_FLOW_DERIVED:
    "Reversals inherit the original review. Opening and year-close sources require their controlled workflow.",
  FINANCE_CASH_FLOW_RETAINED:
    "Confirmed cash-flow history is retained. Record an explicit replacement.",
  FINANCE_PERIOD_CLOSED:
    "The original and every linked reversal period must be open before changing classifications.",
  FINANCE_FORBIDDEN: "Finance access is unavailable.",

  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_INVALID_INPUT: "Check the cash-flow filters or reviewed components.",
  FINANCE_STALE_VERSION:
    "This cash-flow review changed. Reload its current version before continuing.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This request key was used for different cash-flow input.",
  FINANCE_DUPLICATE: "This cash-flow review was already recorded.",
};
function databaseError(e: unknown): never {
  const code = (
    e as {
      meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } };
    }
  )?.meta?.driverAdapterError?.cause?.originalMessage;
  if (code && messages[code])
    throw new AppError(
      code,
      messages[code],
      [
        "FINANCE_FORBIDDEN",
        "FINANCE_OWNER_REQUIRED",
        "FINANCE_REAUTH_REQUIRED",
      ].includes(code)
        ? 403
        : code === "FINANCE_INVALID_INPUT"
          ? 422
          : 409,
    );
  throw new AppError(
    "FINANCE_CASH_FLOW_UNAVAILABLE",
    "Cash-flow processing is unavailable. Retry the same filters or action.",
    503,
  );
}
type Paging = { total: number; page: number; pages: number };
export type CashFlowReport = Paging & {
  metadata: ReportMetadata;
  openingBalance: string;
  closingBalance: string;
  externalNet: string;
  internalNet: string;
  unclassifiedNet: string;
  difference: string;
  unclassifiedCount: number;
  classificationReady: boolean;
  categories: {
    category: string;
    inflows: string;
    outflows: string;
    net: string;
  }[];
  items: {
    journalId: string;
    postingDate: string;
    reference: string;
    sourceType: string;
    sourceId: string;
    originalJournalId: string | null;
    reviewId: string | null;
    classified: boolean;
    cashChange: string;
    cashLegCount: number;
  }[];
};
export type CashFlowReview = {
  source: {
    journalId: string;
    postingDate: string;
    reference: string;
    sourceType: string;
    sourceId: string;
    sourceAction: string;
    description: string;
  };
  lines: {
    id: string;
    sequence: number;
    accountId: string;
    code: string;
    name: string;
    active: boolean;
    amount: string;
    direction: "INFLOW" | "OUTFLOW";
    components: { category: string; amount: string }[];
  }[];
  originalJournalId: string | null;
  basisHash: string;
  reviewAllowed: boolean;
  internalOnly: boolean;
  review: {
    id: string;
    version: 2;
    evidence: string;
    reason: string;
    createdAt: string;
    sourceHash: string;
  } | null;
  history: {
    id: string;
    state: string;
    version: number;
    evidence: string;
    reason: string;
    createdAt: string;
    createdById: string;
    supersededAt: string | null;
    supersededById: string | null;
    supersedeReason: string | null;
    replacesId: string | null;
    sourceHash: string;
  }[];
  page: number;
  total: number;
};
async function read<T>(
  actor: Pick<Actor, "id">,
  kind: "REPORT" | "REVIEW",
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_cash_flow_read(${actor.id}::uuid,${kind},${JSON.stringify(input)}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      return databaseError(e);
    }
  });
}
export const cashFlow = (actor: Pick<Actor, "id">, input: unknown) =>
  read<CashFlowReport>(actor, "REPORT", cashFlowQuerySchema.parse(input));
export const cashFlowReview = (actor: Pick<Actor, "id">, input: unknown) =>
  read<CashFlowReview>(actor, "REVIEW", cashFlowReviewQuerySchema.parse(input));
export async function cashFlowConfirm(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  input: unknown,
  key: string | null,
  requestId = crypto.randomUUID(),
) {
  requireFinanceEnabled();
  await financeStatus(actor);
  invariant(
    key && key.length >= 8 && key.length <= 128,
    "IDEMPOTENCY_REQUIRED",
    "Provide an Idempotency-Key of8–128 characters.",
    400,
  );
  const normalized = cashFlowConfirmSchema.parse(input),
    evidence = consumeFinanceProof(proof, actor.id, "cash-flow:CONFIRM:" + key);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (
        await db.$queryRaw<
          {
            data: {
              id: string;
              version: number;
              journalId: string;
              state: string;
            };
          }[]
        >`SELECT public.encova_finance_cash_flow_command(${actor.id}::uuid,${evidence.provider},${evidence.sessionId},${evidence.verifiedAt}::timestamptz,${"CONFIRM"},${JSON.stringify(normalized)}::jsonb,${key},${requestId}::uuid) AS data`
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
    "Concurrent cash-flow change; retry.",
    409,
  );
}
