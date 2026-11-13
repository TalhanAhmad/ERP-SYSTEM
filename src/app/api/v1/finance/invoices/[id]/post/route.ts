import { invoiceMutation } from "@/modules/finance/receivables/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => invoiceMutation(r, "POST", (await c.params).id);
