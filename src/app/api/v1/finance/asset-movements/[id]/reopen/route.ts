import { assetMovementMutation } from "@/modules/finance/assets/lifecycle/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  assetMovementMutation(r, "REOPEN", (await c.params).id);
