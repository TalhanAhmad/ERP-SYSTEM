import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { AppError, invariant } from "@/server/errors";
import {
  requireFinanceEnabled,
  financeStatus,
  withFinanceAccess,
} from "../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../access/reauth";
import {
  automationSchemas,
  automationQuery,
  automationOptions,
  type AutomationAction,
} from "./schemas";
import type {
  AutomationMode,
  AutomationPaging,
  Schedule,
  RecurringRun,
  Attempt,
  Recognition,
  CreditReview,
} from "./types";
const messages: Record<string, string> = {
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_OWNER_REQUIRED:
    "Only the current Finance Owner can configure or approve this action.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_INVALID_INPUT:
    "Check the schedule, mapping, dates and review evidence.",
  FINANCE_NOT_FOUND: "This private record is unavailable.",
  FINANCE_STALE_VERSION: "This record changed. Reload before continuing.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This request key was used for different input.",
  FINANCE_AUTOMATION_STATE:
    "This action is unavailable for the current record state.",
  FINANCE_AUTOMATION_REVOKED:
    "The original owner or grant is no longer current. Create a newly reviewed schedule.",
  FINANCE_AUTOMATION_MAPPING: "Review the active source accounts and mappings.",
  FINANCE_AUTOMATION_RETAINED:
    "Schedule and attempt history cannot be overwritten.",
  FINANCE_RECOGNITION_CAPACITY:
    "Recognition exceeds the remaining deferred obligation at this or a later effective date.",
  FINANCE_RECOGNITION_RETAINED:
    "Retain the original recognition and use its dated reversal.",
  FINANCE_PERIOD_UNAVAILABLE: "Choose a posting date in an open period.",
  FINANCE_OPENING_DATE: "Posting before the reviewed cutover is unavailable.",
  FINANCE_OPENING_CREDIT_REVIEW:
    "The owner must review the opening-equity classification for this exact credit draft.",
  FINANCE_SOURCE_MISMATCH:
    "The original source, journal and events must agree.",
  FINANCE_DEFERRED_MISMATCH:
    "The deferred event must match its original journal.",
  FINANCE_DUPLICATE: "This reviewed source already exists.",
};
function fail(error: unknown): never {
  const code = (
    error as {
      meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } };
    }
  )?.meta?.driverAdapterError?.cause?.originalMessage;
  if (code && messages[code])
    throw new AppError(
      code,
      messages[code],
      code === "FINANCE_NOT_FOUND"
        ? 404
        : [
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
    "FINANCE_AUTOMATION_UNAVAILABLE",
    "Preparation is unavailable. Retry with the same request key.",
    503,
  );
}
export async function automationCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: AutomationAction,
  id: unknown,
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
  const normalized = {
      ...automationSchemas[action].parse(input),
      ...([
        "CREATE",
        "PREPARE",
        "RECOGNITION_CREATE",
        "OPENING_CREDIT_REVIEW",
      ].includes(action)
        ? {}
        : { id: z.uuid().parse(id) }),
    },
    v = consumeFinanceProof(
      proof,
      actor.id,
      "automation:" + action + ":" + key,
    );
  for (let n = 0; n < 3; n++)
    try {
      return (
        await db.$queryRaw<
          {
            data: {
              id: string;
              version: number;
              state?: string;
              queued?: number;
              journalId?: string;
              reviewId?: string;
            };
          }[]
        >`SELECT public.encova_finance_automation_command(${actor.id}::uuid,${v.provider},${v.sessionId},${v.verifiedAt}::timestamptz,${action},${JSON.stringify(normalized)}::jsonb,${key},${requestId}::uuid) AS data`
      )[0].data;
    } catch (e) {
      const c = (
        e as {
          meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
        }
      )?.meta?.driverAdapterError?.cause?.originalCode;
      if (["40001", "40P01"].includes(c ?? "") && n < 2) continue;
      fail(e);
    }
  throw new AppError(
    "CONCURRENT_CHANGE",
    "Concurrent preparation changed. Retry.",
    409,
  );
}
async function read<T>(
  actor: Pick<Actor, "id">,
  mode: AutomationMode,
  id: unknown,
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_automation_read(${actor.id}::uuid,${mode},${JSON.stringify({ ...input, ...(id ? { id: z.uuid().parse(id) } : {}) })}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      fail(e);
    }
  });
}
export const recurringSchedules = (a: Pick<Actor, "id">, q: unknown = {}) =>
  read<AutomationPaging<Schedule>>(
    a,
    "SCHEDULES",
    null,
    automationQuery.parse(q),
  );
export const recurringRuns = (a: Pick<Actor, "id">, q: unknown = {}) =>
  read<AutomationPaging<RecurringRun>>(
    a,
    "RUNS",
    null,
    automationQuery.parse(q),
  );
export const recurringSchedule = (
  a: Pick<Actor, "id">,
  id: unknown,
  q: unknown = {},
) =>
  read<AutomationPaging<RecurringRun> & { schedule: Schedule }>(
    a,
    "SCHEDULE",
    id,
    automationQuery.parse(q),
  );
export const recurringRun = (a: Pick<Actor, "id">, id: unknown) =>
  read<{ run: RecurringRun; attempts: Attempt[]; canManage: boolean }>(
    a,
    "RUN",
    id,
    {},
  );
export const recognitions = (a: Pick<Actor, "id">, q: unknown = {}) =>
  read<AutomationPaging<Recognition>>(
    a,
    "RECOGNITIONS",
    null,
    automationQuery.parse(q),
  );
export const recognition = (a: Pick<Actor, "id">, id: unknown) =>
  read<{ item: Recognition; remainingDeferred: string; canManage: boolean }>(
    a,
    "RECOGNITION",
    id,
    {},
  );
export const openingCreditReviews = (a: Pick<Actor, "id">, q: unknown = {}) =>
  read<AutomationPaging<CreditReview>>(
    a,
    "CREDIT_REVIEWS",
    null,
    automationQuery.parse(q),
  );
export function preparationOptions(a: Pick<Actor, "id">, q: unknown) {
  const input = automationOptions.parse(q);
  return read<
    AutomationPaging<{
      id: string;
      tag?: string;
      number?: string;
      reference?: string;
      description: string;
      balance?: string;
    }>
  >(
    a,
    input.kind === "ASSET"
      ? "ASSET_OPTIONS"
      : input.kind === "EQUITY"
        ? "EQUITY_OPTIONS"
        : "DEFERRED_OPTIONS",
    null,
    {
      q: input.q,
      page: input.page,
      ...(input.asOf ? { asOf: input.asOf } : {}),
    },
  );
}

export const openingCreditStatus = (
  actor: Pick<Actor, "id">,
  side: "CUSTOMER" | "SUPPLIER",
  id: unknown,
) =>
  read<{
    required: boolean;
    version: number;
    state: string;
    review: CreditReview | null;
    canManage: boolean;
  }>(actor, "CREDIT_STATUS", id, { side });
