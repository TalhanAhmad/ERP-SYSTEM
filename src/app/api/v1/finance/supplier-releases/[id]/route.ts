import { supplierRead } from "@/modules/finance/payables/supplier/http";
export const GET = async (r: Request, c: { params: Promise<{ id: string }> }) =>
  supplierRead(r, "UNALLOCATION", (await c.params).id);
