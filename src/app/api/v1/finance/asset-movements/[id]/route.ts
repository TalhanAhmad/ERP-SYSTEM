import {
  assetMovementRead,
  assetMovementMutation,
} from "@/modules/finance/assets/lifecycle/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  assetMovementRead(r, (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  assetMovementMutation(r, "UPDATE", (await c.params).id);
