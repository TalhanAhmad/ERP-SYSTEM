import { supplierMutation } from "@/modules/finance/payables/supplier/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => supplierMutation(r, "ADVANCE_APPLICATION", "VOID", (await c.params).id);
