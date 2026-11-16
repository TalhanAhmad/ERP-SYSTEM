import { planningMutation } from "@/modules/finance/planning/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  planningMutation(r, "FORECAST_REOPEN", (await c.params).id);
