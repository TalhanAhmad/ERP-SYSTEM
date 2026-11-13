import {
  invoiceRead,
  invoiceMutation,
} from "@/modules/finance/receivables/http";
type Context = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: Context) =>
  invoiceRead(r, (await c.params).id);
export const PATCH = async (r: Request, c: Context) =>
  invoiceMutation(r, "UPDATE", (await c.params).id);
