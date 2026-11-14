import { holdingMutation } from "@/modules/finance/investments/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => holdingMutation(r, "ARCHIVE", (await c.params).id);
