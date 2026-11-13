import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { withFinanceAccess } from "../access/policy";
export async function invoiceOptions(actor: Pick<Actor, "id">, input: unknown) {
  return withFinanceAccess(actor, async (tx) => {
    const q = z
      .object({
        kind: z.enum(["party", "project", "invoice", "cash-account"]),
        q: z.string().trim().max(100).default(""),
        partyId: z.uuid().optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(input);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    if (q.kind === "invoice") {
      const partyId = z.uuid().parse(q.partyId);
      const count = await tx.$queryRaw<
        { total: bigint }[]
      >`SELECT count(*) AS total FROM(SELECT i.id FROM "FinanceInvoice" i JOIN "FinanceReceivableEvent" e ON e."invoiceId"=i.id WHERE i.state='POSTED' AND i."partyId"=${partyId}::uuid AND position(lower(${q.q}) in lower(i.number||' '||i.description))>0 GROUP BY i.id HAVING sum(e.amount)>0)x`;
      const total = Number(count[0].total),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(q.page, pages);
      const rows = await tx.$queryRaw<
        { id: string; code: string; name: string; balance: string }[]
      >`SELECT i.id,i.number AS code,i.description AS name,sum(e.amount)::text AS balance FROM "FinanceInvoice" i JOIN "FinanceReceivableEvent" e ON e."invoiceId"=i.id WHERE i.state='POSTED' AND i."partyId"=${partyId}::uuid AND position(lower(${q.q}) in lower(i.number||' '||i.description))>0 GROUP BY i.id HAVING sum(e.amount)>0 ORDER BY i.number,i.id LIMIT 25 OFFSET ${(page - 1) * 25}`;
      return {
        items: rows.map((i) => ({
          id: i.id,
          code: i.code,
          name: i.name + " · available PKR " + i.balance,
        })),
        total,
        pages,
        page,
      };
    }
    if (q.kind === "cash-account") {
      const where = {
        active: true,
        glAccount: { active: true },
        name: { contains: q.q, mode: "insensitive" as const },
      };
      const total = await tx.financeCashAccount.count({ where }),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(q.page, pages);
      const items = await tx.financeCashAccount.findMany({
        where,
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 25,
        skip: (page - 1) * 25,
      });
      return {
        items: items.map((i) => ({ ...i, code: "" })),
        total,
        pages,
        page,
      };
    }
    const where = {
      ...(q.kind === "party"
        ? { active: true, kind: { in: ["CLIENT", "BOTH"] } }
        : { archivedAt: null }),
      name: { contains: q.q, mode: "insensitive" as const },
    };
    const total =
      q.kind === "party"
        ? await tx.financeParty.count({ where })
        : await tx.project.count({ where });
    const pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages),
      opts = {
        where,
        select: { id: true, name: true },
        orderBy: [{ name: "asc" as const }, { id: "asc" as const }],
        skip: (page - 1) * 25,
        take: 25,
      };
    const items =
      q.kind === "party"
        ? await tx.financeParty.findMany(opts)
        : await tx.project.findMany(opts);
    return {
      items: items.map((i) => ({ ...i, code: "" })),
      total,
      pages,
      page,
    };
  });
}
