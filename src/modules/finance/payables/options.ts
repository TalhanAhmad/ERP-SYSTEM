import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { withFinanceAccess } from "../access/policy";
export async function supplierOptions(
  actor: Pick<Actor, "id">,
  input: unknown,
) {
  return withFinanceAccess(actor, async (tx) => {
    const q = z
      .object({
        kind: z.enum([
          "party",
          "supplier",
          "project",
          "bill",
          "cash-account",
          "supplier-advance-source",
          "credit-bill",
          "bill-line",
        ]),
        q: z.string().trim().max(100).default(""),
        partyId: z.uuid().optional(),
        billId: z.uuid().optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(input);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    if (q.kind === "credit-bill") {
      const partyId = z.uuid().parse(q.partyId),
        where = {
          state: "POSTED",
          partyId,
          OR: [
            { number: { contains: q.q, mode: "insensitive" as const } },
            { description: { contains: q.q, mode: "insensitive" as const } },
          ],
        };
      const total = await tx.financeBill.count({ where }),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(q.page, pages),
        items = await tx.financeBill.findMany({
          where,
          select: { id: true, number: true, description: true },
          orderBy: [{ number: "asc" }, { id: "asc" }],
          take: 25,
          skip: (page - 1) * 25,
        });
      return {
        items: items.map((i) => ({
          id: i.id,
          code: i.number,
          name: i.description,
        })),
        total,
        pages,
        page,
      };
    }
    if (q.kind === "bill-line") {
      const billId = z.uuid().parse(q.billId),
        count = await tx.$queryRaw<
          { total: bigint }[]
        >`SELECT count(*) AS total FROM(SELECT l.id FROM "FinanceBillLine" l JOIN "FinanceBill" i ON i.id=l."billId" LEFT JOIN "FinanceBillCreditEvent" e ON e."billLineId"=l.id WHERE l."billId"=${billId}::uuid AND i.state='POSTED' AND position(lower(${q.q}) in lower(l.description))>0 GROUP BY l.id HAVING l."totalAmount"+coalesce(sum(e.amount),0)>0)x`;
      const total = Number(count[0].total),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(q.page, pages),
        items = await tx.$queryRaw<
          {
            id: string;
            sequence: number;
            description: string;
            balance: string;
          }[]
        >`SELECT l.id,l.sequence,l.description,(l."totalAmount"+coalesce(sum(e.amount),0))::text AS balance FROM "FinanceBillLine" l JOIN "FinanceBill" i ON i.id=l."billId" LEFT JOIN "FinanceBillCreditEvent" e ON e."billLineId"=l.id WHERE l."billId"=${billId}::uuid AND i.state='POSTED' AND position(lower(${q.q}) in lower(l.description))>0 GROUP BY l.id HAVING l."totalAmount"+coalesce(sum(e.amount),0)>0 ORDER BY l.sequence,l.id LIMIT 25 OFFSET ${(page - 1) * 25}`;
      return {
        items: items.map((i) => ({
          id: i.id,
          code: "Line " + i.sequence,
          name: i.description + " · remaining credit PKR " + i.balance,
        })),
        total,
        pages,
        page,
      };
    }
    if (q.kind === "supplier-advance-source") {
      const partyId = z.uuid().parse(q.partyId),
        count = await tx.$queryRaw<
          { total: bigint }[]
        >`SELECT count(*) AS total FROM(SELECT d.id FROM "FinanceSupplierDocument" d JOIN "FinanceSupplierBalanceEvent" b ON b."sourceDocumentId"=d.id WHERE d.state='POSTED' AND d.kind IN('PAYMENT','SUPPLIER_CREDIT','UNALLOCATION') AND d."partyId"=${partyId}::uuid AND position(lower(${q.q}) in lower(d.number||' '||d.description))>0 GROUP BY d.id HAVING sum(b.amount)>0)x`;
      const total = Number(count[0].total),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(q.page, pages),
        rows = await tx.$queryRaw<
          { id: string; code: string; name: string; balance: string }[]
        >`SELECT d.id,d.number AS code,d.description AS name,sum(b.amount)::text AS balance FROM "FinanceSupplierDocument" d JOIN "FinanceSupplierBalanceEvent" b ON b."sourceDocumentId"=d.id WHERE d.state='POSTED' AND d.kind IN('PAYMENT','SUPPLIER_CREDIT','UNALLOCATION') AND d."partyId"=${partyId}::uuid AND position(lower(${q.q}) in lower(d.number||' '||d.description))>0 GROUP BY d.id HAVING sum(b.amount)>0 ORDER BY d.number,d.id LIMIT 25 OFFSET ${(page - 1) * 25}`;
      return {
        items: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name + " · available PKR " + r.balance,
        })),
        total,
        pages,
        page,
      };
    }
    if (q.kind === "bill") {
      const partyId = z.uuid().parse(q.partyId);
      const count = await tx.$queryRaw<
        { total: bigint }[]
      >`SELECT count(*) AS total FROM(SELECT i.id FROM "FinanceBill" i JOIN "FinancePayableEvent" e ON e."billId"=i.id WHERE i.state='POSTED' AND i."partyId"=${partyId}::uuid AND position(lower(${q.q}) in lower(i.number||' '||i.description))>0 GROUP BY i.id HAVING sum(e.amount)>0)x`;
      const total = Number(count[0].total),
        pages = Math.max(1, Math.ceil(total / 25)),
        page = Math.min(q.page, pages);
      const rows = await tx.$queryRaw<
        { id: string; code: string; name: string; balance: string }[]
      >`SELECT i.id,i.number AS code,i.description AS name,sum(e.amount)::text AS balance FROM "FinanceBill" i JOIN "FinancePayableEvent" e ON e."billId"=i.id WHERE i.state='POSTED' AND i."partyId"=${partyId}::uuid AND position(lower(${q.q}) in lower(i.number||' '||i.description))>0 GROUP BY i.id HAVING sum(e.amount)>0 ORDER BY i.number,i.id LIMIT 25 OFFSET ${(page - 1) * 25}`;
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
      ...(q.kind === "party" || q.kind === "supplier"
        ? {
            active: true,
            kind: {
              in:
                q.kind === "supplier"
                  ? ["SUPPLIER", "BOTH", "EMPLOYEE"]
                  : ["SUPPLIER", "BOTH", "EMPLOYEE"],
            },
          }
        : { archivedAt: null }),
      name: { contains: q.q, mode: "insensitive" as const },
    };
    const total =
      q.kind === "party" || q.kind === "supplier"
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
      q.kind === "party" || q.kind === "supplier"
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
