import "server-only";
import { z } from "zod";
import type { Actor } from "@/server/context";
import { withFinanceAccess } from "../access/policy";
export async function invoiceOptions(actor: Pick<Actor, "id">, input: unknown) {
  return withFinanceAccess(actor, async (tx) => {
    const q = z
      .object({
        kind: z.enum(["party", "project"]),
        q: z.string().trim().max(100).default(""),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(input);
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
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
