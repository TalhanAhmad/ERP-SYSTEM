import { taxMutation } from "@/modules/finance/taxes/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => taxMutation(r, "RETIRE", (await c.params).id);
