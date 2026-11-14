import { costMutation } from "@/modules/finance/projects/costs/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  costMutation(r, "POST", (await c.params).id);
