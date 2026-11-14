import {
  movementRead,
  movementMutation,
} from "@/modules/finance/treasury/http";
type Context = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: Context) =>
  movementRead(r, (await c.params).id);
export const PATCH = async (r: Request, c: Context) =>
  movementMutation(r, "UPDATE", (await c.params).id);
