import "server-only";
import type { Actor } from "@/server/context";
import { AppError } from "@/server/errors";
import { withFinanceAccess } from "../../access/policy";
import type { ReportMetadata } from "../service";
import { ageingQuerySchema, ageingHistoryQuerySchema } from "./schemas";
export type AgeingSide = "AR" | "AP";
type Paging = { total: number; page: number; pages: number };
export type AgeingDocument = {
  id: string;
  partyId: string;
  accountId: string;
  number: string;
  reference: string | null;
  documentDate: string;
  dueDate: string;
  originalAmount: string;
  openAmount: string;
  daysPastDue: number;
  bucket: string;
  eventCount: number;
};
export type AgeingReport = Paging & {
  metadata: ReportMetadata;
  side: AgeingSide;
  totals: {
    openAmount: string;
    openDocumentCount: number;
    notDue: string;
    days1To30: string;
    days31To60: string;
    days61To90: string;
    over90: string;
  };
  reconciliation: {
    ready: boolean;
    subledgerTotal: string;
    controlTotal: string;
    difference: string;
    issueCount: number;
    negativeDocumentCount: number;
    issues: {
      accountId: string;
      code: string;
      name: string;
      active: boolean;
      subledgerBalance: string;
      controlBalance: string;
      difference: string;
      negativeDocuments: number;
    }[];
    page: number;
    pages: number;
  };
  items: (AgeingDocument & {
    partyName: string;
    accountCode: string;
    accountName: string;
    accountActive: boolean;
  })[];
};
export type AgeingHistory = Paging & {
  metadata: ReportMetadata;
  side: AgeingSide;
  document: AgeingDocument;
  items: {
    id: string;
    journalId: string;
    effectiveDate: string;
    kind: string;
    amount: string;
    runningBalance: string;
    sourceType: string;
    sourceId: string;
    reference: string;
  }[];
};
async function read<T>(
  actor: Pick<Actor, "id">,
  kind: string,
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_ageing_read(${actor.id}::uuid,${kind},${JSON.stringify(input)}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      const code = (
        e as {
          meta?: {
            driverAdapterError?: { cause?: { originalMessage?: string } };
          };
        }
      )?.meta?.driverAdapterError?.cause?.originalMessage;
      if (code === "FINANCE_FORBIDDEN")
        throw new AppError(code, "Finance access is unavailable.", 403);
      if (code === "FINANCE_NOT_FOUND")
        throw new AppError(
          code,
          "No posted document exists at this cutoff.",
          404,
        );
      if (code === "FINANCE_INVALID_INPUT")
        throw new AppError(
          code,
          "Check the ageing cutoff, display filters and pages.",
          422,
        );
      throw new AppError(
        "FINANCE_AGEING_UNAVAILABLE",
        "Historical ageing is unavailable. Retry the same filters.",
        503,
      );
    }
  });
}
export const ageing = (
  actor: Pick<Actor, "id">,
  side: AgeingSide,
  input: unknown,
) =>
  read<AgeingReport>(actor, "REPORT_" + side, ageingQuerySchema.parse(input));
export const ageingHistory = (
  actor: Pick<Actor, "id">,
  side: AgeingSide,
  input: unknown,
) =>
  read<AgeingHistory>(
    actor,
    "HISTORY_" + side,
    ageingHistoryQuerySchema.parse(input),
  );
