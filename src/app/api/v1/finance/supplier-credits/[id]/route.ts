import {
  supplierRead,
  supplierMutation,
} from "@/modules/finance/payables/supplier/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  supplierRead(r, "SUPPLIER_CREDIT", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  supplierMutation(r, "SUPPLIER_CREDIT", "UPDATE", (await c.params).id);
