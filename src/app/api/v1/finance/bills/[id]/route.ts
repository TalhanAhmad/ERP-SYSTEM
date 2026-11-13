import { billRead, billMutation } from "@/modules/finance/payables/http";
type Context = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: Context) =>
  billRead(r, (await c.params).id);
export const PATCH = async (r: Request, c: Context) =>
  billMutation(r, "UPDATE", (await c.params).id);
