import {
  holdingRead,
  holdingMutation,
} from "@/modules/finance/investments/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  holdingRead(r, (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  holdingMutation(r, "UPDATE", (await c.params).id);
