import "server-only";
import type { Actor } from "@/server/context";
import { AppError } from "@/server/errors";
import { withFinanceAccess } from "../../access/policy";
import type { ReportMetadata } from "../service";
import {
  rollforwardKindSchema,
  rollforwardQuerySchema,
  rollforwardHistorySchema,
  postedSourceQuerySchema,
} from "./schemas";
export type RollforwardKind = ReturnType<typeof rollforwardKindSchema.parse>;
type Paging = { total: number; page: number; pages: number };
export type RollforwardValues = {
  metric: string;
  unit: "PKR" | "UNITS";
  openingBalance: string;
  increases: string;
  decreases: string;
  periodNet: string;
  closingBalance: string;
};
export type RollforwardDimension = {
  rowKey: string;
  entityId: string | null;
  name: string;
  number: string | null;
  active: boolean;
  entityHref: string | null;
  metric: string;
  unit: "PKR" | "UNITS";
  eventCount: number;
  accountCount: number;
};
export type RollforwardReport = Paging & {
  metadata: ReportMetadata;
  kind: RollforwardKind;
  totals: RollforwardValues[];
  reconciliation: {
    ready: boolean;
    issueCount: number;
    controlCount: number;
    negativeRowCount: number;
    openingBookDifference: string;
    closingBookDifference: string;
    issues: {
      issueKey: string;
      scope: "ACCOUNT" | "NEGATIVE_ROW" | "BOOK";
      label: string;
      accountId: string | null;
      rowKey: string | null;
      metric: string | null;
      openingSubledger: string | null;
      openingControl: string | null;
      openingDifference: string | null;
      closingSubledger: string | null;
      closingControl: string | null;
      closingDifference: string | null;
    }[];
    page: number;
    pages: number;
  };
  items: (RollforwardDimension &
    RollforwardValues & { periodEventCount: number })[];
};
export type RollforwardHistory = Paging & {
  metadata: ReportMetadata;
  kind: RollforwardKind;
  dimension: RollforwardDimension;
  openingBalance: string;
  closingBalance: string;
  items: {
    eventKey: string;
    effectiveDate: string;
    accountId: string | null;
    code: string | null;
    accountName: string | null;
    amount: string;
    runningBalance: string;
    journalId: string | null;
    sourceType: string;
    sourceId: string;
    reference: string;
    description: string;
  }[];
};
export type PostedSource = Paging & {
  metadata: ReportMetadata;
  entry: {
    id: string;
    reference: string;
    sourceType: string;
    sourceId: string;
    sourceAction: string;
    postingDate: string;
    postedAt: string;
    postedBy: string;
    description: string;
    evidence: string;
    originalJournalId: string | null;
  };
  workflow: { href: string; kind: string; original: boolean } | null;
  debitTotal: string;
  creditTotal: string;
  difference: string;
  items: {
    id: string;
    sequence: number;
    accountId: string;
    code: string;
    accountName: string;
    accountActive: boolean;
    description: string;
    debit: string;
    credit: string;
    projectId: string | null;
    projectName: string | null;
    partyId: string | null;
    partyName: string | null;
  }[];
};
async function read<T>(
  actor: Pick<Actor, "id">,
  operation: "REPORT" | "HISTORY" | "SOURCE",
  kind: string,
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      const rows =
        operation === "SOURCE"
          ? await tx.$queryRaw<
              { data: T }[]
            >`SELECT public.encova_finance_posted_source_read(${actor.id}::uuid,${JSON.stringify(input)}::jsonb) AS data`
          : await tx.$queryRaw<
              { data: T }[]
            >`SELECT public.encova_finance_rollforward_read(${actor.id}::uuid,${kind},${operation},${JSON.stringify(input)}::jsonb) AS data`;
      return rows[0].data;
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
          "No posted source exists for this report selection.",
          404,
        );
      if (code === "FINANCE_INVALID_INPUT")
        throw new AppError(
          code,
          "Check report dates, source identity and page filters.",
          422,
        );
      throw new AppError(
        "FINANCE_ROLLFORWARD_UNAVAILABLE",
        "Posted report processing is unavailable. Retry the same selection.",
        503,
      );
    }
  });
}
export const rollforward = (
  actor: Pick<Actor, "id">,
  kind: unknown,
  input: unknown,
) =>
  read<RollforwardReport>(
    actor,
    "REPORT",
    rollforwardKindSchema.parse(kind),
    rollforwardQuerySchema.parse(input),
  );
export const rollforwardHistory = (
  actor: Pick<Actor, "id">,
  kind: unknown,
  input: unknown,
) =>
  read<RollforwardHistory>(
    actor,
    "HISTORY",
    rollforwardKindSchema.parse(kind),
    rollforwardHistorySchema.parse(input),
  );
export const postedSource = (actor: Pick<Actor, "id">, input: unknown) =>
  read<PostedSource>(actor, "SOURCE", "", postedSourceQuerySchema.parse(input));
