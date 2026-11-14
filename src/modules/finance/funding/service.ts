import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { withFinanceAccess } from "../access/policy";
export async function fundingBalances(
  actor: Pick<Actor, "id">,
  input: unknown = {},
) {
  return withFinanceAccess(actor, async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
    const q = z
      .object({
        q: z.string().trim().max(100).default(""),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(input);
    const total = Number(
        (
          await tx.$queryRaw<
            { total: bigint }[]
          >`SELECT count(DISTINCT e."partyId") AS total FROM "FinanceFundingEvent" e JOIN "FinanceParty" p ON p.id=e."partyId" WHERE position(lower(${q.q}) IN lower(p.name))>0`
        )[0].total,
      ),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages);
    const items = await tx.$queryRaw<
      {
        partyId: string;
        name: string;
        capital: string;
        contributions: string;
        returns: string;
        outlays: string;
        reimbursed: string;
        distributions: string;
        founderPayable: string;
      }[]
    >`SELECT p.id AS "partyId",p.name,round(coalesce(sum(e.amount) FILTER(WHERE e.bucket='CAPITAL'),0),2)::text AS capital,
 round(coalesce(sum(e.amount) FILTER(WHERE coalesce(o.kind,m.kind) IN('CAPITAL_CONTRIBUTION','NONCASH_CAPITAL')),0),2)::text AS contributions,
 round(-coalesce(sum(e.amount) FILTER(WHERE coalesce(o.kind,m.kind)='CAPITAL_RETURN'),0),2)::text AS returns,
 round(coalesce(sum(e.amount) FILTER(WHERE coalesce(o.kind,m.kind) IN('FOUNDER_OUTLAY','FOUNDER_BILL_SETTLEMENT')),0),2)::text AS outlays,
 round(-coalesce(sum(e.amount) FILTER(WHERE coalesce(o.kind,m.kind)='FOUNDER_REIMBURSEMENT'),0),2)::text AS reimbursed,
 round(coalesce(sum(e.amount) FILTER(WHERE e.bucket='DISTRIBUTION'),0),2)::text AS distributions,round(coalesce(sum(e.amount) FILTER(WHERE e.bucket='FOUNDER_PAYABLE'),0),2)::text AS "founderPayable" FROM "FinanceFundingEvent" e JOIN "FinanceParty" p ON p.id=e."partyId" JOIN "FinanceMovement" m ON m.id=e."movementId" LEFT JOIN "FinanceMovement" o ON o.id=m."reversalOfId" WHERE position(lower(${q.q}) IN lower(p.name))>0 GROUP BY p.id ORDER BY p.name,p.id LIMIT 25 OFFSET ${(page - 1) * 25}`;
    return { items, total, page, pages, filters: q };
  });
}
