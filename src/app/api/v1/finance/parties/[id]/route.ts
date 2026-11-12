import { masterRead, masterMutation } from "@/modules/finance/masters/http";
type Context = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: Context) =>
  masterRead(r, "parties", (await c.params).id);
export const PATCH = async (r: Request, c: Context) =>
  masterMutation(r, "PARTY_UPDATE", (await c.params).id);
