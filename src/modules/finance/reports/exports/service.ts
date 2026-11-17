import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { AppError, invariant } from "@/server/errors";
import {
  withFinanceAccess,
  requireFinanceEnabled,
  financeStatus,
} from "../../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../../access/reauth";
import {
  exportRequestSchema,
  exportChangeSchema,
  exportQuerySchema,
} from "./schemas";
import type { ExportRegister, ExportDetail } from "./types";
const errors: Record<string, string> = {
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_NOT_FOUND: "Export is unavailable.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_INVALID_INPUT: "Check the export report, dates and filters.",
  FINANCE_STALE_VERSION: "This export changed. Reload before continuing.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This request key was used for different export input.",
  FINANCE_EXPORT_STATE:
    "This export cannot be changed or downloaded in its current state, or has expired.",
};
export function exportError(e: unknown): never {
  const code = (
    e as {
      meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } };
    }
  )?.meta?.driverAdapterError?.cause?.originalMessage;
  if (code && errors[code])
    throw new AppError(
      code,
      errors[code],
      code === "FINANCE_FORBIDDEN" || code === "FINANCE_REAUTH_REQUIRED"
        ? 403
        : code === "FINANCE_NOT_FOUND"
          ? 404
          : code === "FINANCE_INVALID_INPUT"
            ? 422
            : 409,
    );
  throw new AppError(
    "FINANCE_EXPORT_UNAVAILABLE",
    "Export processing is unavailable. Retry the same request key.",
    503,
  );
}
export async function exportCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: "REQUEST" | "RETRY" | "CANCEL",
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
  const body =
      action === "REQUEST"
        ? exportRequestSchema.parse(input)
        : exportChangeSchema.parse(input),
    e = consumeFinanceProof(proof, actor.id, "exports:" + action + ":" + key);
  for (let n = 0; n < 3; n++)
    try {
      return (
        await db.$queryRaw<
          { data: { id: string; version: number; state: string } }[]
        >`SELECT public.encova_finance_export_command(${actor.id}::uuid,${e.provider},${e.sessionId},${e.verifiedAt}::timestamptz,${action},${JSON.stringify(body)}::jsonb,${key},${requestId}::uuid) AS data`
      )[0].data;
    } catch (error) {
      const code = (
        error as {
          meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
        }
      )?.meta?.driverAdapterError?.cause?.originalCode;
      if (["40001", "40P01"].includes(code ?? "") && n < 2) continue;
      exportError(error);
    }
  throw new AppError(
    "CONCURRENT_CHANGE",
    "Concurrent export change; retry.",
    409,
  );
}
async function read<T>(
  actor: Pick<Actor, "id">,
  action: string,
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_export_read(${actor.id}::uuid,${action},${JSON.stringify(input)}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      exportError(e);
    }
  });
}
export const exportRegister = (actor: Pick<Actor, "id">, q: unknown = {}) =>
  read<ExportRegister>(actor, "LIST", exportQuerySchema.parse(q));
export const exportDetail = (
  actor: Pick<Actor, "id">,
  id: unknown,
  q: unknown = {},
) =>
  read<ExportDetail>(actor, "DETAIL", {
    id: z.uuid().parse(id),
    ...exportQuerySchema.parse(q),
  });
export async function exportDownload(
  actor: Pick<Actor, "id">,
  id: unknown,
  format: unknown,
) {
  const target = z.uuid().parse(id),
    kind = z.enum(["csv", "pdf"]).parse(format);
  const bytes = await withFinanceAccess(actor, async (tx) => {
    try {
      return (
        await tx.$queryRaw<
          { bytes: Uint8Array }[]
        >`SELECT public.encova_finance_export_download(${actor.id}::uuid,${target}::uuid,${kind}) AS bytes`
      )[0].bytes;
    } catch (e) {
      exportError(e);
    }
  });
  // A second current check after artifact retrieval closes grant/role changes during the read.
  const current = await exportDetail(actor, target);
  invariant(
    current.state === "READY" && !current.expired,
    "FINANCE_EXPORT_STATE",
    "This export is unavailable or expired.",
    409,
  );
  return { bytes: new Uint8Array(bytes), format: kind, id: target };
}
