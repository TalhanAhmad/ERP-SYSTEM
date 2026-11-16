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
  profitLossQuerySchema,
  balanceSheetQuerySchema,
  statementSettingsQuerySchema,
  statementSettingSchemas,
  type StatementSettingAction,
} from "./schemas";
const messages: Record<string, string> = {
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_OWNER_REQUIRED:
    "Only the current Finance Owner changes statement presentation.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_INVALID_INPUT:
    "Check the statement filters or reviewed presentation fields.",
  FINANCE_STALE_VERSION:
    "This presentation setting changed. Reload its current version before continuing.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This request key was used for different presentation input.",
  FINANCE_DUPLICATE: "This presentation setting was already recorded.",
  FINANCE_STATEMENT_MAPPING_RETAINED:
    "Presentation history is retained. Deactivate a tax mapping or restore an unreviewed policy explicitly.",
  FINANCE_STATEMENT_TAX_MAPPING:
    "Income-tax expense presentation requires an ordinary PKR operating/other expense posting account. VAT and withholding controls are separate.",
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
    "FINANCE_STATEMENT_UNAVAILABLE",
    "Statement processing is unavailable. Retry the same filters or action.",
    503,
  );
}
type Paging = { total: number; page: number; pages: number };
export type StatementReadiness = {
  finalExportEligible: boolean;
  booksBalanced: boolean;
  booksDifference: string;
  issueCount: number;
  issues: {
    id: string;
    code: string;
    name: string;
    type: string;
    reportGroup: string;
    balance: string;
    issue: string;
  }[];
  page: number;
  pages: number;
  policy: {
    id?: string;
    overdraftPresentation: "UNREVIEWED" | "CURRENT_LIABILITY";
    version: number | null;
    evidence?: string;
  };
};
export type ProfitLossReport = Paging & {
  metadata: ReportMetadata;
  readiness: StatementReadiness;
  sections: {
    revenue: string;
    directCosts: string;
    grossProfit: string;
    operatingExpenses: string;
    operatingProfit: string;
    otherIncome: string;
    otherExpenses: string;
    profitBeforeIncomeTax: string;
    incomeTaxExpense: string;
    netProfit: string;
  };
  items: {
    id: string;
    code: string;
    name: string;
    type: string;
    reportGroup: string;
    active: boolean;
    statementGroup: string;
    taxMappingId: string | null;
    taxMappingVersion: number | null;
    periodDebit: string;
    periodCredit: string;
    statementAmount: string;
  }[];
};
export type BalanceSheetReport = Paging & {
  metadata: ReportMetadata;
  readiness: StatementReadiness;
  sections: {
    currentAssets: string;
    noncurrentAssets: string;
    totalAssets: string;
    currentLiabilities: string;
    noncurrentLiabilities: string;
    totalLiabilities: string;
    postedEquity: string;
    unclosedProfit: string;
    totalEquity: string;
    difference: string;
  };
  items: {
    id: string;
    code: string;
    name: string;
    type: string;
    reportGroup: string;
    active: boolean;
    statementGroup: string;
    originalBalance: string;
    statementAmount: string;
    presentationChanged: boolean;
  }[];
};
export type StatementSettings = Paging & {
  policy: {
    id: string;
    overdraftPresentation: "UNREVIEWED" | "CURRENT_LIABILITY";
    evidence: string;
    version: number;
    updatedAt: string;
    updatedBy: string;
  } | null;
  items: {
    id: string;
    accountId: string;
    code: string;
    name: string;
    type: string;
    accountActive: boolean;
    active: boolean;
    evidence: string;
    version: number;
    updatedAt: string;
    updatedBy: string;
  }[];
  history: {
    id: string;
    action: string;
    reason: string;
    createdAt: string;
    actor: string;
  }[];
  isOwner: boolean;
};
async function read<T>(
  actor: Pick<Actor, "id">,
  kind: "PROFIT_LOSS" | "BALANCE_SHEET" | "SETTINGS" | "MAPPING_OPTIONS",
  input: Record<string, unknown>,
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    try {
      return (
        await tx.$queryRaw<
          { data: T }[]
        >`SELECT public.encova_finance_statement_report(${actor.id}::uuid,${kind},${JSON.stringify(input)}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      return databaseError(e);
    }
  });
}
export const profitLoss = (actor: Pick<Actor, "id">, input: unknown) =>
  read<ProfitLossReport>(
    actor,
    "PROFIT_LOSS",
    profitLossQuerySchema.parse(input),
  );
export const balanceSheet = (actor: Pick<Actor, "id">, input: unknown) =>
  read<BalanceSheetReport>(
    actor,
    "BALANCE_SHEET",
    balanceSheetQuerySchema.parse(input),
  );
export const statementSettings = (
  actor: Pick<Actor, "id">,
  input: unknown = {},
) =>
  read<StatementSettings>(
    actor,
    "SETTINGS",
    statementSettingsQuerySchema.parse(input),
  );
export async function statementMappingOptions(
  actor: Pick<Actor, "id">,
  input: unknown = {},
) {
  const r = await read<
    Paging & {
      items: { id: string; code: string; name: string; active: boolean }[];
    }
  >(actor, "MAPPING_OPTIONS", statementSettingsQuerySchema.parse(input));
  return {
    ...r,
    items: r.items.map((a) => ({
      ...a,
      name: a.name + (a.active ? "" : " (archived)"),
    })),
  };
}
export async function statementSettingCommand(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: StatementSettingAction,
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
  const normalized = statementSettingSchemas[action].parse(input),
    evidence = consumeFinanceProof(
      proof,
      actor.id,
      "statement-settings:" + action + ":" + key,
    );
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (
        await db.$queryRaw<
          {
            data: {
              id: string;
              version: number;
              overdraftPresentation?: string;
              accountId?: string;
              active?: boolean;
            };
          }[]
        >`SELECT public.encova_finance_statement_settings_command(${actor.id}::uuid,${evidence.provider},${evidence.sessionId},${evidence.verifiedAt}::timestamptz,${action},${JSON.stringify(normalized)}::jsonb,${key},${requestId}::uuid) AS data`
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
    "Concurrent presentation change; retry.",
    409,
  );
}
export async function statementTaxMapping(
  actor: Pick<Actor, "id">,
  accountId: string,
) {
  const { z } = await import("zod");
  return withFinanceAccess(actor, async (tx) => {
    z.uuid().parse(accountId);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    return {
      item: await tx.financeStatementTaxMapping.findUnique({
        where: { accountId },
        select: {
          id: true,
          accountId: true,
          active: true,
          evidence: true,
          version: true,
          updatedAt: true,
          account: {
            select: { code: true, name: true, type: true, active: true },
          },
          updatedBy: { select: { displayName: true } },
        },
      }),
    };
  });
}
