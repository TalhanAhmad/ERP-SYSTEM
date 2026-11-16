import { costRead, costMutation } from "@/modules/finance/projects/costs/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  costRead(r, "ALLOCATION", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  costMutation(r, "UPDATE", (await c.params).id);
