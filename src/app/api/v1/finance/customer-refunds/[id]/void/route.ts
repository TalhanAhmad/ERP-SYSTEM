import { customerMutation } from "@/modules/finance/receivables/customer/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => customerMutation(r, "CUSTOMER_REFUND", "VOID", (await c.params).id);
