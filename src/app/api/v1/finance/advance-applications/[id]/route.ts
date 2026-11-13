import {
  customerRead,
  customerMutation,
} from "@/modules/finance/receivables/customer/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  customerRead(r, "ADVANCE_APPLICATION", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  customerMutation(r, "ADVANCE_APPLICATION", "UPDATE", (await c.params).id);
