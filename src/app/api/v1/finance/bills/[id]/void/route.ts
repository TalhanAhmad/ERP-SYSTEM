import { billMutation } from "@/modules/finance/payables/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => billMutation(r, "VOID", (await c.params).id);
