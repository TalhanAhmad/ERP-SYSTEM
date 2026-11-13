import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { withFinanceAccess } from "../access/policy";
import { accountTypes, reportGroups } from "./catalog";
export const optionQuerySchema = z
  .object({
    kind: z.enum([
      "parent",
      "journal",
      "cash",
      "receivable",
      "revenue",
      "deferred",
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
        deferred: {
          controlType: "DEFERRED_REVENUE",
          type: "LIABILITY",
          isContra: false,
        },
      }[query.kind as "receivable" | "revenue" | "deferred"] ?? {}),
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
