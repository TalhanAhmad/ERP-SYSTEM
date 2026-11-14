import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { withFinanceAccess } from "../access/policy";
import { accountTypes, reportGroups } from "./catalog";
export const optionQuerySchema = z
  .object({
    kind: z.enum([
      "loan-receivable",
      "loan-payable",
      "interest-receivable",
      "interest-payable",
      "funding-cost",
      "funding-asset",
      "capital",
      "distribution",
      "founder-payable",
      "tax-input",
      "tax-output",
      "withholding-receivable",
      "withholding-payable",
      "supplier-advance",
      "payable",
      "cost",
      "prepayment",
      "fixed-asset",
      "parent",
      "journal",
      "cash",
      "receivable",
      "revenue",
      "deferred",
      "fee",
      "advance",
    ]),
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    type: z.enum(accountTypes).optional(),
    group: z.enum(reportGroups).optional(),
    exclude: z.uuid().optional(),
  })
  .strict();
export async function accountOptions(actor: Pick<Actor, "id">, input: unknown) {
  return withFinanceAccess(actor, async (tx) => {
    const query = optionQuerySchema.parse(input);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    const where: Prisma.FinanceAccountWhereInput = {
      active: true,
      isPosting: query.kind !== "parent",
      ...(query.kind === "journal"
        ? { controlType: "NONE" }
        : query.kind === "cash"
          ? { controlType: "CASH", type: "ASSET", isContra: false }
          : {}),
      ...({
        "loan-receivable": {
          controlType: "LOAN_RECEIVABLE",
          type: "ASSET",
          isContra: false,
        },
        "loan-payable": {
          controlType: "LOAN_PAYABLE",
          type: "LIABILITY",
          isContra: false,
        },
        "interest-receivable": {
          controlType: "INTEREST_RECEIVABLE",
          type: "ASSET",
          isContra: false,
        },
        "interest-payable": {
          controlType: "INTEREST_PAYABLE",
          type: "LIABILITY",
          isContra: false,
        },
        "funding-cost": {
          controlType: { in: ["NONE", "FIXED_ASSET"] },
          type: {
            in: ["ASSET", "DIRECT_COST", "OPERATING_EXPENSE", "OTHER_EXPENSE"],
          },
          isContra: false,
        },
        "funding-asset": {
          controlType: { in: ["NONE", "FIXED_ASSET"] },
          type: "ASSET",
          isContra: false,
        },
        capital: { controlType: "CAPITAL", type: "EQUITY", isContra: false },
        distribution: {
          controlType: "DISTRIBUTION",
          type: "EQUITY",
          isContra: false,
        },
        "founder-payable": {
          controlType: "FOUNDER_PAYABLE",
          type: "LIABILITY",
          isContra: false,
        },
        "tax-input": {
          controlType: "TAX_INPUT",
          type: "ASSET",
          isContra: false,
        },
        "tax-output": {
          controlType: "TAX_OUTPUT",
          type: "LIABILITY",
          isContra: false,
        },
        "withholding-receivable": {
          controlType: "WITHHOLDING_RECEIVABLE",
          type: "ASSET",
          isContra: false,
        },
        "withholding-payable": {
          controlType: "WITHHOLDING_PAYABLE",
          type: "LIABILITY",
          isContra: false,
        },
        "supplier-advance": {
          controlType: "SUPPLIER_ADVANCE",
          type: "ASSET",
          isContra: false,
        },
        payable: {
          controlType: "PAYABLES",
          type: "LIABILITY",
          isContra: false,
        },
        cost: {
          controlType: "NONE",
          type: { in: ["DIRECT_COST", "OPERATING_EXPENSE", "OTHER_EXPENSE"] },
          isContra: false,
        },
        prepayment: { controlType: "NONE", type: "ASSET", isContra: false },
        "fixed-asset": {
          controlType: "FIXED_ASSET",
          type: "ASSET",
          isContra: false,
        },
        receivable: {
          controlType: "RECEIVABLES",
          type: "ASSET",
          isContra: false,
        },
        revenue: {
          controlType: "NONE",
          type: { in: ["INCOME", "OTHER_INCOME"] },
          isContra: false,
        },
        advance: {
          controlType: "CLIENT_ADVANCE",
          type: "LIABILITY",
          isContra: false,
        },
        fee: {
          controlType: "NONE",
          type: { in: ["DIRECT_COST", "OPERATING_EXPENSE", "OTHER_EXPENSE"] },
          isContra: false,
        },
        deferred: {
          controlType: "DEFERRED_REVENUE",
          type: "LIABILITY",
          isContra: false,
        },
      }[
        query.kind as
          | "loan-receivable"
          | "loan-payable"
          | "interest-receivable"
          | "interest-payable"
          | "funding-cost"
          | "funding-asset"
          | "capital"
          | "distribution"
          | "founder-payable"
          | "tax-input"
          | "tax-output"
          | "withholding-receivable"
          | "withholding-payable"
          | "supplier-advance"
          | "payable"
          | "cost"
          | "prepayment"
          | "fixed-asset"
          | "receivable"
          | "revenue"
          | "deferred"
          | "fee"
          | "advance"
      ] ?? {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.group ? { reportGroup: query.group } : {}),
      ...(query.exclude ? { id: { not: query.exclude } } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: "insensitive" } },
              { name: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const total = await tx.financeAccount.count({ where }),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(query.page, pages);
    const items = await tx.financeAccount.findMany({
      where,
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      take: 25,
      skip: (page - 1) * 25,
    });
    return { items, total, page, pages };
  });
}
