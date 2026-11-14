import { assetMutation } from "@/modules/finance/assets/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => assetMutation(r, "VOID", (await c.params).id);
