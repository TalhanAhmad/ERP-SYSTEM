import { planningMutation } from "@/modules/finance/planning/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  planningMutation(r, "BUDGET_VOID", (await c.params).id);
