import { movementMutation } from "@/modules/finance/treasury/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => movementMutation(r, "VOID", (await c.params).id);
