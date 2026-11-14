import { costRead } from "@/modules/finance/projects/costs/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  costRead(r, "SOURCE", (await c.params).id);
