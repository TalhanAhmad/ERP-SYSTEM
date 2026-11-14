import { holdingRead } from "@/modules/finance/investments/http";
export const GET = async (r: Request, c: { params: Promise<{ id: string }> }) =>
  holdingRead(r, (await c.params).id, true);
