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
import { openingSchemas, openingQuery, type OpeningAction } from "./schemas";
import type {
  OpeningBatch,
  OpeningPreview,
  OpeningPaging,
  OpeningLine,
} from "./types";
const errors: Record<string, string> = {
  FINANCE_OPENING_MAPPING:
    "Review the opening account, party, register and policy mappings.",
  FINANCE_OPENING_INCOMPLETE:
    "Resolve every opening checklist item and match all detailed control balances before posting.",
  FINANCE_OPENING_STALE:
    "The source mappings or ledger changed. Refresh and review before posting.",
  FINANCE_OPENING_RETAINED:
    "Opening data and posted history cannot be overwritten or removed.",
  FINANCE_OPENING_PROOF:
    "The opening journals, subledgers and clearing proof do not agree.",
  FINANCE_OPENING_DATE:
    "Posting before the reviewed opening cutover is unavailable.",
  FINANCE_OPENING_HISTORY:
    "Historical source documents must be handled through the reviewed opening workflow.",
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_OWNER_REQUIRED:
    "Only the current Finance Owner can import or approve opening balances.",
  FINANCE_NOT_FOUND: "This opening batch is unavailable.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_INVALID_INPUT:
    "Check the opening file, cutover fields and review evidence.",
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
    "FINANCE_OPENING_UNAVAILABLE",
    "Opening review is unavailable. Retry with the same request key.",
    503,
  );
}
export async function openingCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: OpeningAction,
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
    "Provide an Idempotency-Key of 8–128 characters.",
    400,
  );
  const normalized = {
      ...openingSchemas[action].parse(input),
      ...(action === "CREATE" ? {} : { id: z.uuid().parse(id) }),
    },
    e = consumeFinanceProof(proof, actor.id, "opening:" + action + ":" + key);
  for (let n = 0; n < 3; n++)
    try {
      return (
        await db.$queryRaw<
          {
            data: {
              id: string;
              version: number;
              state: string;
              sourceHash: string;
            };
          }[]
        >`SELECT public.encova_finance_opening_command(${actor.id}::uuid,${e.provider},${e.sessionId},${e.verifiedAt}::timestamptz,${action},${JSON.stringify(normalized)}::jsonb,${key},${requestId}::uuid) AS data`
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
    "Concurrent opening change; retry.",
    409,
  );
}
async function read<T>(
  actor: Pick<Actor, "id">,
  action: string,
  id: unknown,
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_opening_read(${actor.id}::uuid,${action},${JSON.stringify({ ...input, ...(id ? { id: z.uuid().parse(id) } : {}) })}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      databaseError(e);
    }
  });
}

export const openingBatches = (a: Pick<Actor, "id">, q: unknown = {}) =>
  read<OpeningPaging<OpeningBatch>>(
    a,
    "LIST",
    undefined,
    openingQuery.parse(q),
  );
export const openingDetail = (a: Pick<Actor, "id">, id: unknown) =>
  read<OpeningBatch>(a, "DETAIL", id, {});
export const openingPreview = (a: Pick<Actor, "id">, id: unknown) =>
  read<OpeningPreview>(a, "PREVIEW", id, {});
export const openingLines = (
  a: Pick<Actor, "id">,
  id: unknown,
  q: unknown = {},
) =>
  read<OpeningPaging<OpeningLine>>(
    a,
    "LINES",
    id,
    openingQuery
      .extend({ kind: z.enum(["ALL", "TB", "ITEMS"]).default("ALL") })
      .parse(q),
  );
export const openingSource = (a: Pick<Actor, "id">, id: unknown) =>
  read<{ fileName: string; sourceText: string; sourceHash: string }>(
    a,
    "SOURCE",
    id,
    {},
  );
