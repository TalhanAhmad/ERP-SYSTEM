import { assetRead, assetMutation } from "@/modules/finance/assets/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  assetRead(r, (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  assetMutation(r, "UPDATE", (await c.params).id);
