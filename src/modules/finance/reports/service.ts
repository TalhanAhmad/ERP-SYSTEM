import "server-only";
import type { Actor } from "@/server/context";
import { AppError } from "@/server/errors";
import { withFinanceAccess } from "../access/policy";
import {
  generalLedgerQuerySchema,
  trialBalanceQuerySchema,
  reportAccountQuerySchema,
} from "./schemas";
export type ReportMetadata = {
  company: string;
  currency: "PKR";
  basis: "POSTED_ACCRUAL";
  timezone: string;
  from: string;
  to: string;
  filters: Record<string, unknown>;
  generatedAt: string;
  databaseSnapshot: string;
  postingCutoffAt: string | null;
  postedEntryCount: number;
  ledgerDigest: string;
};
type Paging = { page: number; pages: number; total: number };
export type GeneralLedgerReport = Paging & {
  metadata: ReportMetadata;
  account: {
    id: string;
    code: string;
    name: string;
    type: string;
    normalSide: string;
    controlType: string;
    active: boolean;
  };
  openingBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingBalance: string;
  items: {
    id: string;
    sequence: number;
    journalId: string;
    postingDate: string;
    reference: string;
    sourceType: string;
    sourceId: string;
    sourceAction: string;
    sourceKind: string;
    isReversal: boolean;
    originalSourceId: string | null;
    originalSourceType: string | null;
    reversalOfId: string | null;
    description: string;
    debit: string;
    credit: string;
    projectId: string | null;
    projectName: string | null;
    partyId: string | null;
    partyName: string | null;
    runningBalance: string;
  }[];
};
export type TrialBalanceReport = Paging & {
  metadata: ReportMetadata;
  companyTotals: {
    openingDebit: string;
    openingCredit: string;
    periodDebit: string;
    periodCredit: string;
    closingDebit: string;
    closingCredit: string;
    openingDifference: string;
    periodDifference: string;
    closingDifference: string;
    accountCount: number;
  };
  items: {
    id: string;
    code: string;
    name: string;
    type: string;
    normalSide: string;
    controlType: string;
    active: boolean;
    openingBalance: string;
    openingDebit: string;
    openingCredit: string;
    periodDebit: string;
    periodCredit: string;
    closingBalance: string;
    closingDebit: string;
    closingCredit: string;
  }[];
};
async function report<T>(
  actor: Pick<Actor, "id">,
  kind: "GENERAL_LEDGER" | "TRIAL_BALANCE" | "ACCOUNT_OPTIONS",
  body: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    // Current role/grant locks are acquired first; every financial writer takes the exclusive config lock.
    // Each canonical SQL report uses one statement snapshot for all rows, aggregates and metadata.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_report_core(${actor.id}::uuid,${kind},${JSON.stringify(body)}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      const code = (
        e as {
          meta?: {
            driverAdapterError?: { cause?: { originalMessage?: string } };
          };
        }
      )?.meta?.driverAdapterError?.cause?.originalMessage;
      if (code === "FINANCE_ACCOUNT_UNAVAILABLE")
        throw new AppError(
          code,
          "Choose an existing PKR posting account, including controls or archived accounts.",
          422,
        );
      if (code === "FINANCE_INVALID_INPUT")
        throw new AppError(
          code,
          "Check the report dates, account and page.",
          422,
        );
      if (code === "FINANCE_FORBIDDEN")
        throw new AppError(code, "Finance access is unavailable.", 403);
      throw new AppError(
        "FINANCE_REPORT_UNAVAILABLE",
        "The posted report is unavailable. Retry the same filters.",
        503,
      );
    }
  });
}
export async function generalLedger(actor: Pick<Actor, "id">, input: unknown) {
  return report<GeneralLedgerReport>(
    actor,
    "GENERAL_LEDGER",
    generalLedgerQuerySchema.parse(input),
  );
}
export async function trialBalance(actor: Pick<Actor, "id">, input: unknown) {
  return report<TrialBalanceReport>(
    actor,
    "TRIAL_BALANCE",
    trialBalanceQuerySchema.parse(input),
  );
}
export async function reportAccountOptions(
  actor: Pick<Actor, "id">,
  input: unknown = {},
) {
  const r = await report<
    Paging & {
      items: {
        id: string;
        code: string;
        name: string;
        active: boolean;
        controlType: string;
      }[];
    }
  >(actor, "ACCOUNT_OPTIONS", reportAccountQuerySchema.parse(input));
  return {
    ...r,
    items: r.items.map((a) => ({
      ...a,
      name: a.name + (a.active ? "" : " (archived)"),
    })),
  };
}
