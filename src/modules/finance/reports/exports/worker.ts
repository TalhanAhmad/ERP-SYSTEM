import "server-only";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { requireFinanceEnabled } from "../../access/policy";
import { renderExportCsv } from "./format";
import { renderExportPdf } from "./pdf";
import type { ExportSnapshot } from "./types";
export async function processExport(id: string) {
  requireFinanceEnabled();
  // Trusted worker boundary: SQL locks and rechecks the stored requester and exact grant epoch.
  // No caller-supplied actor, balances, snapshot, classification or readiness is accepted.
  const claim = (
    await db.$queryRaw<
      {
        data: {
          id: string;
          leaseId: string;
          snapshotHash: string;
          snapshot: ExportSnapshot;
        } | null;
      }[]
    >`SELECT public.encova_finance_export_claim(${id}::uuid) AS data`
  )[0].data;
  if (!claim) return;
  let csv: Buffer | null = null,
    pdf: Buffer | null = null,
    failure: string | null = null;
  try {
    csv = renderExportCsv(claim.snapshot, claim.snapshotHash);
    pdf = await renderExportPdf(claim.snapshot, claim.snapshotHash);
  } catch (e) {
    failure =
      e instanceof Error && e.message === "FINANCE_EXPORT_LIMIT"
        ? e.message
        : "FINANCE_EXPORT_RENDER";
  }
  // Authorization/lease checks run again after rendering; revoked and stale workers cannot issue bytes.
  await db.$queryRaw`SELECT public.encova_finance_export_finish(${claim.id}::uuid,${claim.leaseId}::uuid,${claim.snapshotHash},${csv}::bytea,${pdf}::bytea,${failure})`;
}
export async function processFinanceExports(deadline = Date.now() + 25000) {
  if (!env.FINANCE_ENABLED) return;
  const ids = await db.$queryRaw<
    { id: string }[]
  >`SELECT public.encova_finance_export_candidates() AS id`;
  for (const { id } of ids) {
    if (Date.now() >= deadline - 5000) break;
    try {
      await processExport(id);
    } catch {
      /* Private job lease supports a later bounded resume; no financial details reach ordinary operations logs. */
    }
  }
}
