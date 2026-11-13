import {
  customerRead,
  customerMutation,
} from "@/modules/finance/receivables/customer/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  customerRead(r, "RECEIPT", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  customerMutation(r, "RECEIPT", "UPDATE", (await c.params).id);
