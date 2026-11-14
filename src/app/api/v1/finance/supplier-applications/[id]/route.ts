import {
  supplierRead,
  supplierMutation,
} from "@/modules/finance/payables/supplier/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  supplierRead(r, "ADVANCE_APPLICATION", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  supplierMutation(r, "ADVANCE_APPLICATION", "UPDATE", (await c.params).id);
