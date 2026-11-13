import { customerMutation } from "@/modules/finance/receivables/customer/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => customerMutation(r, "ADVANCE_APPLICATION", "POST", (await c.params).id);
