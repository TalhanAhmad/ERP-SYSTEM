import { costMutation } from "@/modules/finance/projects/costs/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  costMutation(r, "REVERSE", (await c.params).id);
