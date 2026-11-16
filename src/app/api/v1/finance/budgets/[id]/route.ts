import {
  planningRead,
  planningMutation,
} from "@/modules/finance/planning/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  planningRead(r, "BUDGET", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  planningMutation(r, "BUDGET_UPDATE", (await c.params).id);
