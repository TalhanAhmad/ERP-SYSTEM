import { ledgerMutation } from "@/modules/finance/ledger/http";
export const POST = async (
  request: Request,
  c: { params: Promise<{ id: string }> },
) => ledgerMutation(request, "POST", (await c.params).id);
