import {
  customerRead,
  customerMutation,
} from "@/modules/finance/receivables/customer/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  customerRead(r, "CUSTOMER_REFUND", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  customerMutation(r, "CUSTOMER_REFUND", "UPDATE", (await c.params).id);
