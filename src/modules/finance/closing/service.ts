import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { db } from "@/server/db";
import { AppError, invariant } from "@/server/errors";
import {
  financeStatus,
  requireFinanceEnabled,
  withFinanceAccess,
} from "../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../access/reauth";
import {
  closeSchemas,
  closeQuerySchema,
  closeReportTypes,
  type CloseAction,
} from "./schemas";
import type {
  ClosePreview,
  CloseItem,
  CloseDetail,
  CloseIssue,
  ClosePaging,
  CloseReport,
} from "./types";
const errors: Record<string, string> = {
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_OWNER_REQUIRED:
    "Only the current Finance Owner can close, reopen or resolve period review issues.",
  FINANCE_NOT_FOUND: "This period or retained close is unavailable.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_INVALID_INPUT: "Check the period fields, source and review evidence.",
  FINANCE_STALE_VERSION: "This record changed. Reload before continuing.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This request key was used for different input.",
  FINANCE_CLOSE_STATE:
    "This action is unavailable for the current period or close state.",
  FINANCE_CLOSE_STALE:
    "The checklist or report basis changed. Refresh and review the current checklist before closing.",
  FINANCE_CLOSE_INCOMPLETE:
    "Resolve all automatic checklist issues before closing, then confirm both owner reviews.",
  FINANCE_CLOSE_REOPEN_ORDER:
    "Reopen later closed periods first, starting with the latest cutoff.",
  FINANCE_PERIOD_UNAVAILABLE:
    "This date is protected by a closed period. Reopen affected periods through the owner workflow.",
  FINANCE_EXPORT_LIMIT:
    "The complete close statements exceed the snapshot limit; a reviewed cutover or larger-volume release is required.",
  FINANCE_CLOSE_RETAINED:
    "Retained close and issue history cannot be overwritten or removed.",
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
    "FINANCE_CLOSE_UNAVAILABLE",
    "Period review is unavailable. Retry with the same request key.",
    503,
  );
}
export async function closeCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: CloseAction,
  periodId: unknown,
  input: unknown,
  key: string | null,
  relatedId?: unknown,
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
  const normalized = {
      ...closeSchemas[action].parse(input),
      periodId: z.uuid().parse(periodId),
      ...(action === "EXPORT"
        ? { closeId: z.uuid().parse(relatedId) }
        : action === "ISSUE_RESOLVE"
          ? { issueId: z.uuid().parse(relatedId) }
          : {}),
    },
    e = consumeFinanceProof(
      proof,
      actor.id,
      "period-close:" + action + ":" + key,
    );
  for (let n = 0; n < 3; n++)
    try {
      return (
        await db.$queryRaw<
          {
            data: {
              id: string;
              version: number;
              state: string;
              periodId: string;
              closeVersion?: number;
              sequence?: number;
            };
          }[]
        >`SELECT public.encova_finance_close_command(${actor.id}::uuid,${e.provider},${e.sessionId},${e.verifiedAt}::timestamptz,${action},${JSON.stringify(normalized)}::jsonb,${key},${requestId}::uuid) AS data`
      )[0].data;
    } catch (error) {
      const c = (
        error as {
          meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
        }
      )?.meta?.driverAdapterError?.cause?.originalCode;
      if (["40001", "40P01"].includes(c ?? "") && n < 2) continue;
      databaseError(error);
    }
  throw new AppError(
    "CONCURRENT_CHANGE",
    "Concurrent close change; retry.",
    409,
  );
}
async function read<T>(
  actor: Pick<Actor, "id">,
  action: string,
  periodId: unknown,
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_close_read(${actor.id}::uuid,${action},${JSON.stringify({ ...input, periodId: z.uuid().parse(periodId) })}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      databaseError(e);
    }
  });
}
export const closePreview = (actor: Pick<Actor, "id">, periodId: unknown) =>
  read<ClosePreview>(actor, "PREVIEW", periodId, {});
export const closeHistory = (
  actor: Pick<Actor, "id">,
  periodId: unknown,
  q: unknown = {},
) =>
  read<ClosePaging<CloseItem>>(
    actor,
    "HISTORY",
    periodId,
    closeQuerySchema.parse(q),
  );
export const closeIssues = (
  actor: Pick<Actor, "id">,
  periodId: unknown,
  q: unknown = {},
) =>
  read<ClosePaging<CloseIssue>>(
    actor,
    "ISSUES",
    periodId,
    closeQuerySchema.parse(q),
  );
export const closeDetail = (
  actor: Pick<Actor, "id">,
  periodId: unknown,
  id: unknown,
) =>
  read<CloseDetail>(actor, "DETAIL", periodId, { closeId: z.uuid().parse(id) });
export const closeReport = (
  actor: Pick<Actor, "id">,
  periodId: unknown,
  id: unknown,
  reportType: unknown,
  q: unknown = {},
) =>
  read<CloseReport>(actor, "REPORT", periodId, {
    closeId: z.uuid().parse(id),
    reportType: z.enum(closeReportTypes).parse(reportType),
    ...closeQuerySchema.parse(q),
  });
