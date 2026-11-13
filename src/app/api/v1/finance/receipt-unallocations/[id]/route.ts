import { customerRead } from "@/modules/finance/receivables/customer/http";
export const GET = async (r: Request, c: { params: Promise<{ id: string }> }) =>
  customerRead(r, "UNALLOCATION", (await c.params).id);
