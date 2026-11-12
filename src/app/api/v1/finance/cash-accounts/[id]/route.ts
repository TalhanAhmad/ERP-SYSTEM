import { masterRead, masterMutation } from "@/modules/finance/masters/http";
type Context = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: Context) =>
  masterRead(r, "cash-accounts", (await c.params).id);
export const PATCH = async (r: Request, c: Context) =>
  masterMutation(r, "CASH_UPDATE", (await c.params).id);
